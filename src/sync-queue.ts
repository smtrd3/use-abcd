import { create, type Draft } from "mutative";
import { last, flatMap, fromPairs, every, find } from "lodash-es";
import type { Change, SyncQueueState, SyncResult, IdMapping } from "./types";

export type SyncQueueConfig<T> = {
  debounce: number;
  maxRetries: number;
  onSync: (changes: Change<T>[], signal: AbortSignal) => Promise<SyncResult[]>;
  onIdRemap?: (mappings: IdMapping[]) => void;
};

// Coalescing rules: returns null for net-zero operations
const coalesce = <T>(ops: Change<T>[], next: Change<T>): Change<T>[] | null => {
  if (!ops.length) return [next];

  const prev = last(ops)!;

  // create + delete = net zero
  if (prev.type === "create" && next.type === "delete") return null;
  // create + update = create with new data
  if (prev.type === "create" && next.type === "update") return [{ ...prev, data: next.data }];
  // update + update = single update with latest data
  if (prev.type === "update" && next.type === "update") return [...ops.slice(0, -1), next];
  // update + delete = keep both (need update before delete)
  if (prev.type === "update" && next.type === "delete") return [...ops, next];
  // Any other combination = replace with new
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

  private async _flush(): Promise<void> {
    const { isPaused, isSyncing, queue } = this._state;
    if (isPaused || isSyncing || queue.size === 0) return;

    // Move queue to inFlight
    this._updateState((draft) => {
      draft.inFlight = new Map(queue) as Draft<Map<string, Change<T>[]>>;
      draft.queue = new Map();
      draft.isSyncing = true;
    });

    const changes = flatMap([...this._state.inFlight.values()]);
    this._abortController = new AbortController();

    try {
      const results = await this._config.onSync(changes, this._abortController.signal);
      this._processResults(fromPairs(results.map((r) => [r.id, r])));
    } catch (error) {
      this._handleError(error);
    }

    this._abortController = null;
    if (this._state.queue.size > 0 && !this._state.isPaused) this._scheduleFlush();
  }

  private _processResults(resultMap: Record<string, SyncResult>): void {
    const inFlight = this._state.inFlight;
    const idMappings: IdMapping[] = [];

    this._updateState((draft) => {
      for (const [id, ops] of inFlight) {
        const allSuccess = every(ops, (op) => resultMap[op.id]?.status === "success");

        if (allSuccess) {
          draft.errors.delete(id);

          // Collect ID mappings for successful create operations
          for (const op of ops) {
            const result = resultMap[op.id];
            if (op.type === "create" && result?.newId && result.newId !== op.id) {
              idMappings.push({ tempId: op.id, newId: result.newId });
            }
          }
        } else {
          const retries = (draft.errors.get(id)?.retries ?? 0) + 1;
          if (retries < this._config.maxRetries && !draft.queue.has(id)) {
            draft.queue.set(id, ops as Draft<Change<T>[]>);
          }
          const failed = find(ops, (op) => resultMap[op.id]?.status !== "success");
          draft.errors.set(id, {
            error: resultMap[failed?.id ?? ""]?.error ?? "Unknown error",
            retries,
            operations: ops as Draft<Change<T>[]>,
          });
        }
      }
      draft.inFlight = new Map();
      draft.isSyncing = false;
    });

    // Notify about ID remappings after state update
    if (idMappings.length > 0 && this._config.onIdRemap) {
      this._config.onIdRemap(idMappings);
    }
  }

  private _handleError(error: unknown): void {
    const inFlight = this._state.inFlight;
    const isAborted = this._abortController?.signal.aborted;
    const errorMsg = error instanceof Error ? error.message : String(error);

    this._updateState((draft) => {
      for (const [id, ops] of inFlight) {
        if (isAborted) {
          if (!draft.queue.has(id)) draft.queue.set(id, ops as Draft<Change<T>[]>);
        } else {
          const retries = (draft.errors.get(id)?.retries ?? 0) + 1;
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
