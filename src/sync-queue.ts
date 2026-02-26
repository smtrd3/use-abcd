import { create, type Draft } from "mutative";
import { size, isEmpty, get, take } from "lodash-es";
import type { Change, SyncQueueState, Result } from "./types";

export type SyncQueueConfig<T, C = unknown> = {
  debounce: number;
  maxRetries: number;
  batchSize?: number;
  getContext?: () => C;
  onSync: (changes: Change<T>[], context: C, signal: AbortSignal) => Promise<Record<string, Result>>;
};

/**
 * Coalesce two operations on the same item into a single operation.
 *
 * Rules:
 * - create + delete = null (net zero)
 * - create + update = create (with new data)
 * - update + update = update (with new data)
 * - update + delete = delete
 * - any other = replace with new
 */
const coalesce = <T>(existing: Change<T> | undefined, next: Change<T>): Change<T> | null => {
  if (!existing) return next;

  if (existing.type === "create" && next.type === "delete") return null;
  if (existing.type === "create" && next.type === "update") return { ...existing, data: next.data };
  if (existing.type === "update" && next.type === "update") return next;
  if (existing.type === "update" && next.type === "delete") return next;

  return next;
};

export class SyncQueue<T, C = unknown> {
  private _config: SyncQueueConfig<T, C>;
  private _state: SyncQueueState<T>;
  private _subscribers = new Set<() => void>();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _abortController: AbortController | null = null;

  constructor(config: SyncQueueConfig<T, C>) {
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
      const existing = draft.queue.get(change.id) as Change<T> | undefined;
      const coalesced = coalesce(existing, change);

      if (coalesced) {
        draft.queue.set(change.id, coalesced as Draft<Change<T>>);
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
      for (const [id, errorInfo] of errors) {
        if (!draft.queue.has(id)) {
          draft.queue.set(id, errorInfo.operation as Draft<Change<T>>);
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
      if (!draft.queue.has(id)) {
        draft.queue.set(id, errorInfo.operation as Draft<Change<T>>);
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
    if (isPaused || isSyncing || isEmpty(queue)) return;

    const batchSize = get(this._config, "batchSize", Infinity);
    const queueEntries = [...queue.entries()];
    const entriesToProcess = take(queueEntries, batchSize);
    const remainingEntries = queueEntries.slice(size(entriesToProcess));

    this._updateState((draft) => {
      draft.inFlight = new Map(entriesToProcess) as Draft<Map<string, Change<T>>>;
      draft.queue = new Map(remainingEntries) as Draft<Map<string, Change<T>>>;
      draft.isSyncing = true;
    });

    const changes = [...this._state.inFlight.values()];
    const context = this._config.getContext?.() as C;
    this._abortController = new AbortController();

    try {
      const results = await this._config.onSync(changes, context, this._abortController.signal);
      this._processResults(results);
    } catch (error) {
      this._handleError(error);
    }

    this._abortController = null;

    if (size(this._state.queue) > 0 && !this._state.isPaused) this._scheduleFlush();
  }

  private _processResults(resultMap: Record<string, Result>): void {
    const inFlight = this._state.inFlight;

    this._updateState((draft) => {
      for (const [id, op] of inFlight) {
        const result = resultMap[id];

        if (result?.status === "success") {
          draft.errors.delete(id);
        } else {
          const retries = (draft.errors.get(id)?.retries ?? 0) + 1;
          if (retries < this._config.maxRetries && !draft.queue.has(id)) {
            draft.queue.set(id, op as Draft<Change<T>>);
          }
          draft.errors.set(id, {
            error: result?.error ?? "Unknown error",
            retries,
            operation: op as Draft<Change<T>>,
          });
        }
      }
      draft.inFlight = new Map();
      draft.isSyncing = false;
    });
  }

  private _handleError(error: unknown): void {
    const inFlight = this._state.inFlight;
    const isAborted = get(this._abortController, "signal.aborted", false);
    const errorMsg = error instanceof Error ? error.message : String(error);

    this._updateState((draft) => {
      for (const [id, op] of inFlight) {
        if (isAborted) {
          if (!draft.queue.has(id)) draft.queue.set(id, op as Draft<Change<T>>);
        } else {
          const retries = (draft.errors.get(id)?.retries ?? 0) + 1;
          if (retries < this._config.maxRetries && !draft.queue.has(id)) {
            draft.queue.set(id, op as Draft<Change<T>>);
          }
          draft.errors.set(id, {
            error: errorMsg,
            retries,
            operation: op as Draft<Change<T>>,
          });
        }
      }
      draft.inFlight = new Map();
      draft.isSyncing = false;
    });
  }
}
