import { create, type Draft } from "mutative";
import {
  last,
  flatMap,
  fromPairs,
  every,
  find,
  initial,
  take,
  size,
  isEmpty,
  isEqual,
  get,
  map,
  forEach,
} from "lodash-es";
import type { Change, SyncQueueState, SyncResult, IdMapping } from "./types";

export type SyncQueueConfig<T> = {
  debounce: number;
  maxRetries: number;
  /**
   * Maximum number of changes to send per sync call.
   * Useful for rate limiting or API constraints.
   * Default: Infinity (send all queued changes)
   */
  batchSize?: number;
  onSync: (changes: Change<T>[], signal: AbortSignal) => Promise<SyncResult[]>;
  onIdRemap?: (mappings: IdMapping[]) => void;
};

/**
 * Coalescing rules for combining pending operations.
 * This optimizes the sync queue by merging redundant operations.
 *
 * Rules:
 * - create + delete = null (net zero - item never existed on server)
 * - create + update = create (with updated data - still a new item)
 * - update + update = single update (only latest state matters)
 * - update + delete = keep both (server needs update before delete)
 * - any other = replace with new operation
 *
 * @returns Combined operations array, or null if operations cancel out
 */
const coalesce = <T>(ops: Change<T>[], next: Change<T>): Change<T>[] | null => {
  if (isEmpty(ops)) return [next];

  const prev = last(ops)!;

  // create + delete = net zero (item was never persisted to server)
  if (isEqual(prev.type, "create") && isEqual(next.type, "delete")) return null;

  // create + update = create with new data (still creating, just with updated values)
  if (isEqual(prev.type, "create") && isEqual(next.type, "update")) {
    return [{ ...prev, data: next.data }];
  }

  // update + update = single update with latest data (intermediate states don't matter)
  if (isEqual(prev.type, "update") && isEqual(next.type, "update")) {
    return [...initial(ops), next];
  }

  // update + delete = keep both (server may need the update applied before deletion)
  if (isEqual(prev.type, "update") && isEqual(next.type, "delete")) {
    return [...ops, next];
  }

  // Any other combination = replace with new operation
  return [next];
};

export class SyncQueue<T> {
  private _config: SyncQueueConfig<T>;
  private _state: SyncQueueState<T>;
  private _subscribers = new Set<() => void>();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _abortController: AbortController | null = null;

  constructor(config: SyncQueueConfig<T>) {
    this._config = config;
    this._state = {
      queue: new Map(),
      inFlight: new Map(),
      errors: new Map(),
      isPaused: false,
      isSyncing: false,
    };
  }

  enqueue(change: Change<T>): void {
    this._updateState((draft) => {
      const existing = [...(draft.queue.get(change.id) ?? [])] as Change<T>[];
      const coalesced = coalesce(existing, change);

      if (coalesced) {
        draft.queue.set(change.id, coalesced as Draft<Change<T>[]>);
      } else {
        draft.queue.delete(change.id);
      }
      draft.errors.delete(change.id);
    });
    this._scheduleFlush();
  }

  pause(): void {
    this._updateState((draft) => {
      draft.isPaused = true;
    });
    this._clearTimer();
  }

  resume(): void {
    this._updateState((draft) => {
      draft.isPaused = false;
    });
    if (this._state.queue.size > 0) this._scheduleFlush();
  }

  retryAll(): void {
    const errors = this._state.errors;
    if (errors.size === 0) return;

    this._updateState((draft) => {
      // Re-queue all failed operations
      for (const [id, errorInfo] of errors) {
        if (!draft.queue.has(id)) {
          draft.queue.set(id, errorInfo.operations as Draft<Change<T>[]>);
        }
      }
      draft.errors.clear();
    });
    this._scheduleFlush();
  }

  retry(id: string): void {
    const errorInfo = this._state.errors.get(id);
    if (!errorInfo) return;

    this._updateState((draft) => {
      // Re-queue the failed operations
      if (!draft.queue.has(id)) {
        draft.queue.set(id, errorInfo.operations as Draft<Change<T>[]>);
      }
      draft.errors.delete(id);
    });
    this._scheduleFlush();
  }

  resetRetries(id: string): void {
    if (!this._state.errors.has(id)) return;
    this._updateState((draft) => {
      const error = draft.errors.get(id);
      if (error) error.retries = 0;
    });
  }

  destroy(): void {
    this._clearTimer();
    this._abortController?.abort("SyncQueue destroyed");
    this._abortController = null;
    this._subscribers.clear();
    this._state = {
      queue: new Map(),
      inFlight: new Map(),
      errors: new Map(),
      isPaused: false,
      isSyncing: false,
    };
  }

  getState(): SyncQueueState<T> {
    return this._state;
  }

  subscribe(callback: () => void): () => void {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  private _updateState(mutator: (draft: Draft<SyncQueueState<T>>) => void): void {
    this._state = create(this._state, mutator);
    this._subscribers.forEach((cb) => cb());
  }

  private _scheduleFlush(): void {
    if (this._state.isPaused || this._state.isSyncing) return;
    this._clearTimer();
    this._debounceTimer = setTimeout(() => this._flush(), this._config.debounce);
  }

  private _clearTimer(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  /**
   * Flush pending changes to the server.
   *
   * Flow:
   * 1. Move queued items to inFlight (atomic swap prevents duplicate sends)
   * 2. Flatten all changes and optionally batch by batchSize
   * 3. Send to server via onSync callback
   * 4. Process results (handle success, retries, ID remapping)
   * 5. Schedule next flush if more items queued
   */
  private async _flush(): Promise<void> {
    const { isPaused, isSyncing, queue } = this._state;
    if (isPaused || isSyncing || isEqual(size(queue), 0)) return;

    const batchSize = get(this._config, "batchSize", Infinity);
    const queueEntries = [...queue.entries()];

    // If batchSize is set, only take a subset of queued items
    // This allows rate-limiting API calls for large queues
    const entriesToProcess = take(queueEntries, batchSize);
    const remainingEntries = queueEntries.slice(size(entriesToProcess));

    // Atomically move selected items to inFlight, keep remaining in queue
    // This prevents duplicate sends if flush is called again
    this._updateState((draft) => {
      draft.inFlight = new Map(entriesToProcess) as Draft<Map<string, Change<T>[]>>;
      draft.queue = new Map(remainingEntries) as Draft<Map<string, Change<T>[]>>;
      draft.isSyncing = true;
    });

    // Flatten all operations from selected items into a single array for the API call
    const changes = flatMap([...this._state.inFlight.values()]);
    this._abortController = new AbortController();

    try {
      const results = await this._config.onSync(changes, this._abortController.signal);
      // Convert results array to a map for O(1) lookup by ID
      this._processResults(fromPairs(map(results, (r) => [r.id, r])));
    } catch (error) {
      this._handleError(error);
    }

    this._abortController = null;

    // Schedule next flush if there are remaining items (from batching or new enqueues)
    if (size(this._state.queue) > 0 && !this._state.isPaused) this._scheduleFlush();
  }

  /**
   * Process sync results and update state accordingly.
   *
   * For each item in flight:
   * - If ALL operations succeeded: clear errors, collect ID remappings
   * - If ANY operation failed: increment retry counter, re-queue if under maxRetries
   *
   * ID Remapping: When server assigns new IDs to created items (e.g., temp ID -> DB ID),
   * we collect these mappings and notify via onIdRemap callback so the collection
   * can update its local state.
   */
  private _processResults(resultMap: Record<string, SyncResult>): void {
    const inFlight = this._state.inFlight;
    const idMappings: IdMapping[] = [];

    this._updateState((draft) => {
      for (const [id, ops] of inFlight) {
        // Check if ALL operations for this item succeeded
        const allSuccess = every(ops, (op) =>
          isEqual(get(resultMap, [op.id, "status"]), "success"),
        );

        if (allSuccess) {
          draft.errors.delete(id);

          // Collect ID mappings for successful create operations
          // Server may assign different IDs than our temporary client IDs
          forEach(ops, (op) => {
            const result = get(resultMap, op.id);
            if (
              isEqual(op.type, "create") &&
              get(result, "newId") &&
              !isEqual(get(result, "newId"), op.id)
            ) {
              idMappings.push({ tempId: op.id, newId: result.newId! });
            }
          });
        } else {
          // Handle failure: track retries and re-queue if under limit
          const retries = get(draft.errors.get(id), "retries", 0) + 1;
          if (retries < this._config.maxRetries && !draft.queue.has(id)) {
            draft.queue.set(id, ops as Draft<Change<T>[]>);
          }

          // Find the first failed operation to extract error message
          const failed = find(ops, (op) => !isEqual(get(resultMap, [op.id, "status"]), "success"));
          draft.errors.set(id, {
            error: get(resultMap, [get(failed, "id", ""), "error"], "Unknown error"),
            retries,
            operations: ops as Draft<Change<T>[]>,
          });
        }
      }
      draft.inFlight = new Map();
      draft.isSyncing = false;
    });

    // Notify about ID remappings after state update completes
    // This allows the collection to remap local items to server-assigned IDs
    if (!isEmpty(idMappings) && this._config.onIdRemap) {
      this._config.onIdRemap(idMappings);
    }
  }

  /**
   * Handle network or unexpected errors during sync.
   *
   * Two scenarios:
   * 1. Aborted (e.g., SyncQueue destroyed): Re-queue all items without incrementing retries
   * 2. Actual error: Increment retries, re-queue if under limit, record error
   *
   * This ensures no data loss - failed operations are preserved for retry.
   */
  private _handleError(error: unknown): void {
    const inFlight = this._state.inFlight;
    const isAborted = get(this._abortController, "signal.aborted", false);
    const errorMsg = error instanceof Error ? error.message : String(error);

    this._updateState((draft) => {
      for (const [id, ops] of inFlight) {
        if (isAborted) {
          // Aborted requests (e.g., component unmount) - re-queue without penalty
          if (!draft.queue.has(id)) draft.queue.set(id, ops as Draft<Change<T>[]>);
        } else {
          // Actual error - track retries and potentially re-queue
          const retries = get(draft.errors.get(id), "retries", 0) + 1;
          if (retries < this._config.maxRetries && !draft.queue.has(id)) {
            draft.queue.set(id, ops as Draft<Change<T>[]>);
          }
          draft.errors.set(id, {
            error: errorMsg,
            retries,
            operations: ops as Draft<Change<T>[]>,
          });
        }
      }
      draft.inFlight = new Map();
      draft.isSyncing = false;
    });
  }
}
