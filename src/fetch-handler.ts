import { create } from "mutative";
import { Cache } from "./cache";
import type { FetchState } from "./types";

export type FetchHandlerConfig<T, C> = {
  id: string;
  cacheCapacity: number;
  cacheTtl: number;
  retries?: number;
  onFetch: (context: C, signal: AbortSignal) => Promise<T[]>;
};

export type FetchHandlerState<T> = {
  status: FetchState;
  items: T[];
  error?: string;
  retryCount?: number;
};

export class FetchHandler<T, C> {
  private _config: FetchHandlerConfig<T, C>;
  private _cache: Cache<T[]>;
  private _state: FetchHandlerState<T> = { status: "idle", items: [] };
  private _subscribers = new Set<() => void>();
  private _abortController: AbortController | null = null;
  private _currentContext: C | null = null;

  constructor(config: FetchHandlerConfig<T, C>) {
    this._config = { retries: 0, ...config };
    this._cache = new Cache<T[]>(config.cacheCapacity, config.cacheTtl);
  }

  private _getCacheKey = (context: C): string => JSON.stringify([this._config.id, context]);

  private _setState(patch: Partial<FetchHandlerState<T>>): void {
    this._state = create(this._state, (draft) => {
      Object.assign(draft, patch);
    });
    this._subscribers.forEach((cb) => cb());
  }

  private async _fetchWithRetry(context: C, signal: AbortSignal): Promise<T[]> {
    const maxRetries = this._config.retries!;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");

      try {
        if (attempt > 0) this._setState({ retryCount: attempt });
        return await this._config.onFetch(context, signal);
      } catch (error) {
        lastError = error;
        if (signal.aborted || attempt === maxRetries) throw error;
      }
    }

    throw lastError;
  }

  async fetch(context: C): Promise<T[]> {
    const cacheKey = this._getCacheKey(context);
    const cached = this._cache.get(cacheKey);

    if (cached !== null) {
      this._currentContext = context;
      this._setState({ status: "idle", items: cached, error: undefined, retryCount: undefined });
      return cached;
    }

    this._abortController?.abort("New fetch request started");
    const abortController = new AbortController();
    this._abortController = abortController;
    this._currentContext = context;
    this._setState({ status: "fetching", error: undefined, retryCount: undefined });

    try {
      const items = await this._fetchWithRetry(context, abortController.signal);
      this._cache.set(cacheKey, items);
      this._abortController = null;
      this._setState({ status: "idle", items, error: undefined, retryCount: undefined });
      return items;
    } catch (error) {
      // If this request was aborted, return current items silently
      if (abortController.signal.aborted) return this._state.items;

      this._abortController = null;
      this._setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async refresh(context?: C): Promise<T[]> {
    const ctx = context ?? this._currentContext;
    if (!ctx) throw new Error("No context provided for refresh");

    this._cache.invalidate(this._getCacheKey(ctx));
    return this.fetch(ctx);
  }

  invalidateCache(): void {
    this._cache.clear();
  }

  invalidateCacheForContext(context: C): void {
    this._cache.invalidate(this._getCacheKey(context));
  }

  getState = (): FetchHandlerState<T> => this._state;
  getContext = (): C | null => this._currentContext;
  isFetching = (): boolean => this._state.status === "fetching";

  subscribe(callback: () => void): () => void {
    this._subscribers.add(callback);
    return () => {
      this._subscribers.delete(callback);
    };
  }
}
