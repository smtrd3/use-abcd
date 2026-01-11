import { create, type Draft } from "mutative";
import { SyncQueue } from "./sync-queue";
import { FetchHandler } from "./fetch-handler";
import { Item } from "./item";
import type {
  Config,
  SyncState,
  Mutator,
  ItemStatus,
  SyncQueueState,
  FetchState,
  IdMapping,
  Change,
  SyncResult,
} from "./types";

export type CollectionState<T, C> = {
  context: C;
  items: Map<string, T>;
  syncState: SyncState;
  loading: boolean;
  syncing: boolean;
  syncQueue: SyncQueueState<T>;
  fetchStatus: FetchState;
  fetchError?: string;
};

export class Collection<T extends object, C> {
  // Global cache of collection instances by id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static _cache = new Map<string, Collection<any, any>>();

  // Get or create a collection instance
  static get<T extends object, C>(config: Config<T, C>): Collection<T, C> {
    const existing = Collection._cache.get(config.id);
    if (existing) {
      return existing as Collection<T, C>;
    }
    const collection = new Collection(config);
    Collection._cache.set(config.id, collection);
    return collection;
  }

  // Clear a specific collection from cache
  static clear(id: string): void {
    Collection._cache.delete(id);
  }

  // Clear all collections from cache
  static clearAll(): void {
    Collection._cache.clear();
  }

  readonly id: string;
  readonly config: Config<T, C>;

  private _state: CollectionState<T, C>;
  private _syncQueue: SyncQueue<T>;
  private _fetchHandler: FetchHandler<T, C>;
  private _itemCache: WeakMap<T & object, Item<T, C>> = new WeakMap();
  private _subscribers: Set<() => void> = new Set();
  private _hasInitialized = false;
  private _batchMode = false;

  constructor(config: Config<T, C>) {
    this.id = config.id;
    this.config = config;

    // Initialize SyncQueue
    // Default no-op sync handler for offline-first mode (all operations succeed locally)
    const defaultOnSync = async (changes: Change<T>[]): Promise<SyncResult[]> =>
      changes.map((c) => ({ id: c.id, status: "success" as const }));

    this._syncQueue = new SyncQueue<T>({
      debounce: config.syncDebounce ?? 300,
      maxRetries: config.syncRetries ?? 3,
      onSync: config.onSync ?? defaultOnSync,
      onIdRemap: (mappings) => this._handleIdRemap(mappings),
    });

    // Initialize FetchHandler
    this._fetchHandler = new FetchHandler<T, C>({
      id: config.id,
      cacheCapacity: config.cacheCapacity ?? 10,
      cacheTtl: config.cacheTtl ?? 60000,
      retries: config.fetchRetries ?? 0,
      onFetch: config.onFetch,
    });

    // Initialize state
    const syncQueueState = this._syncQueue.getState();
    const fetchState = this._fetchHandler.getState();
    this._state = {
      context: config.initialContext,
      items: new Map(),
      syncState: "idle",
      loading: false,
      syncing: false,
      syncQueue: syncQueueState,
      fetchStatus: fetchState.status,
      fetchError: fetchState.error,
    };

    // Subscribe to SyncQueue changes
    this._syncQueue.subscribe(() => {
      this._onSyncQueueChange();
    });

    // Subscribe to FetchHandler changes
    this._fetchHandler.subscribe(() => {
      this._onFetchChange();
    });

    // Start initial fetch
    this._initialFetch();
  }

  // Getters for convenience (read from state)
  get context(): C {
    return this._state.context;
  }

  get items(): Map<string, T> {
    return this._state.items;
  }

  get loading(): boolean {
    return this._state.loading;
  }

  get syncing(): boolean {
    return this._state.syncing;
  }

  get syncQueue(): SyncQueueState<T> {
    return this._state.syncQueue;
  }

  // Subscribe to state changes
  subscribe(callback: () => void): () => void {
    this._subscribers.add(callback);
    return () => {
      this._subscribers.delete(callback);
    };
  }

  // Get current state (for useSyncExternalStore) - returns cached reference
  getState(): CollectionState<T, C> {
    return this._state;
  }

  // Get item status from sync queue state
  getItemStatus(id: string): ItemStatus {
    const { queue, inFlight, errors } = this._state.syncQueue;

    const inFlightChanges = inFlight.get(id);
    if (inFlightChanges && inFlightChanges.length > 0) {
      // Use the last operation as the most relevant status
      const lastChange = inFlightChanges[inFlightChanges.length - 1];
      return {
        type: lastChange.type,
        status: "syncing",
        retries: errors.get(id)?.retries ?? 0,
      };
    }

    const queuedChanges = queue.get(id);
    if (queuedChanges && queuedChanges.length > 0) {
      // Use the last operation as the most relevant status
      const lastChange = queuedChanges[queuedChanges.length - 1];
      const errorInfo = errors.get(id);
      return {
        type: lastChange.type,
        status: errorInfo ? "error" : "pending",
        retries: errorInfo?.retries ?? 0,
        error: errorInfo?.error,
      };
    }

    const errorInfo = errors.get(id);
    if (errorInfo) {
      return {
        type: "update",
        status: "error",
        retries: errorInfo.retries,
        error: errorInfo.error,
      };
    }

    return null;
  }

  // Create a new item (local-first)
  create(item: T): void {
    const id = this.config.getId(item);

    this._state = create(this._state, (draft) => {
      draft.items.set(id, item as Draft<T>);
    });

    this._fetchHandler.invalidateCache();
    this._notifySubscribers();
    this._syncQueue.enqueue({ id, type: "create", data: item });
  }

  // Update an existing item (local-first)
  update(id: string, mutate: (draft: Draft<T>) => void): void {
    const currentItem = this._state.items.get(id);
    if (!currentItem) return;

    const newItem = create(currentItem, mutate);

    this._state = create(this._state, (draft) => {
      draft.items.set(id, newItem as Draft<T>);
    });

    this._fetchHandler.invalidateCache();
    this._notifySubscribers();
    this._syncQueue.enqueue({ id, type: "update", data: newItem });
  }

  // Remove an item (local-first)
  remove(id: string): void {
    const item = this._state.items.get(id);
    if (!item) return;

    this._state = create(this._state, (draft) => {
      draft.items.delete(id);
    });

    // WeakMap will automatically GC the Item when data object is no longer referenced
    this._fetchHandler.invalidateCache();
    this._notifySubscribers();

    this._syncQueue.enqueue({ id, type: "delete", data: item });
  }

  // Get Item reference (cached by data object)
  getItem(id: string): Item<T, C> {
    const data = this._state.items.get(id);
    if (!data) {
      // Item doesn't exist, create a placeholder that will return undefined
      return new Item(this, id);
    }

    // Use data object as WeakMap key
    const dataAsObject = data as T & object;
    let item = this._itemCache.get(dataAsObject);
    if (!item) {
      item = new Item(this, id);
      this._itemCache.set(dataAsObject, item);
    }
    return item;
  }

  // Update context and refetch
  setContext(patchContext: Mutator<C>): void {
    const oldContext = this._state.context;
    const newContext = create(oldContext, patchContext);

    if (oldContext !== newContext) {
      this._state = create(this._state, (draft) => {
        draft.context = newContext as Draft<C>;
      });

      this._fetchHandler.fetch(newContext);
      this._notifySubscribers();
    }
  }

  // Force refresh (bypass cache)
  async refresh(): Promise<void> {
    this._fetchHandler.invalidateCache();
    await this._fetchHandler.fetch(this._state.context);
  }

  // SyncQueue controls
  pauseSync(): void {
    this._syncQueue.pause();
  }

  resumeSync(): void {
    this._syncQueue.resume();
    // Refetch to get fresh data after resuming
    this._fetchHandler.invalidateCache();
    this._fetchHandler.fetch(this._state.context);
  }

  retrySync(id?: string): void {
    if (id) {
      this._syncQueue.retry(id);
    } else {
      this._syncQueue.retryAll();
    }
  }

  // Cleanup everything and remove from global cache
  destroy(): void {
    this._syncQueue.destroy();
    this._fetchHandler.destroy();
    this._subscribers.clear();
    Collection._cache.delete(this.id);
  }

  // Private methods
  private async _initialFetch(): Promise<void> {
    if (this._hasInitialized) return;
    this._hasInitialized = true;
    await this._fetchHandler.fetch(this._state.context);
  }

  private _onSyncQueueChange(): void {
    const currState = this._syncQueue.getState();
    this._updateSyncState(currState);
  }

  private _onFetchChange(): void {
    const fetchState = this._fetchHandler.getState();

    // Single state update
    this._state = create(this._state, (draft) => {
      draft.fetchStatus = fetchState.status;
      draft.fetchError = fetchState.error;
      draft.loading = fetchState.status === "fetching";
      draft.syncState = this._computeSyncState(fetchState.status, draft.syncQueue.isSyncing);

      const { queue, inFlight } = this._state.syncQueue;
      const newItems = new Map<string, Draft<T>>();

      // Add all fetched items
      for (const item of fetchState.items) {
        const id = this.config.getId(item);
        newItems.set(id, item as Draft<T>);
      }

      // Preserve local pending changes (creates/updates not yet synced)
      for (const [id, changes] of queue) {
        // Use the last change's data as the most up-to-date local state
        const lastChange = changes[changes.length - 1];
        if (lastChange.type === "create" || lastChange.type === "update") {
          newItems.set(id, lastChange.data as Draft<T>);
        }
      }
      for (const [id, changes] of inFlight) {
        // Use the last change's data as the most up-to-date local state
        const lastChange = changes[changes.length - 1];
        if (lastChange.type === "create" || lastChange.type === "update") {
          newItems.set(id, lastChange.data as Draft<T>);
        }
      }

      draft.items = newItems;
    });

    this._notifySubscribers();
  }

  private _updateSyncState(syncQueueState: SyncQueueState<T>): void {
    this._state = create(this._state, (draft) => {
      draft.syncQueue = syncQueueState as Draft<SyncQueueState<T>>;
      draft.syncing = syncQueueState.isSyncing;
      draft.syncState = this._computeSyncState(draft.fetchStatus, syncQueueState.isSyncing);
    });

    this._notifySubscribers();
  }

  private _computeSyncState(fetchStatus: FetchState, isSyncing: boolean): SyncState {
    if (fetchStatus === "fetching") {
      return "fetching";
    }
    if (isSyncing) {
      return "syncing";
    }
    return "idle";
  }

  private _notifySubscribers(): void {
    if (this._batchMode) return;
    for (const callback of this._subscribers) {
      callback();
    }
  }

  private _handleIdRemap(mappings: IdMapping[]): void {
    if (mappings.length === 0) return;

    const { setId } = this.config;

    this._state = create(this._state, (draft) => {
      for (const { tempId, newId } of mappings) {
        // Get the item with the temporary ID
        const item = draft.items.get(tempId);
        if (item) {
          // Update the item's id using setId if provided, otherwise assume 'id' property
          let updatedItem: Draft<T>;
          if (setId) {
            updatedItem = setId(item as T, newId) as Draft<T>;
          } else {
            // Default: assume the item has an 'id' property
            (item as Record<string, unknown>).id = newId;
            updatedItem = item;
          }

          // Remove old entry and add with new ID
          draft.items.delete(tempId);
          draft.items.set(newId, updatedItem);
        }
      }
    });

    // Update cached Item instances with new IDs
    // Since we use data objects as WeakMap keys, the WeakMap automatically
    // maps the new data object created above to any cached Item instances
    for (const { newId } of mappings) {
      const data = this._state.items.get(newId);
      if (data) {
        const dataAsObject = data as T & object;
        const cachedItem = this._itemCache.get(dataAsObject);
        if (cachedItem) {
          // Update the Item's internal ID to the new permanent ID
          cachedItem._updateId(newId);
        }
      }
    }

    this._notifySubscribers();
  }
}
