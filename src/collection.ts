import { create, type Draft } from "mutative";
import { fromPairs, map, set } from "lodash-es";
import { SyncQueue } from "./sync-queue";
import { FetchHandler } from "./fetch-handler";
import { Item } from "./item";
import { Node, type TreeNode } from "./node";
import type {
  Config,
  SyncState,
  Mutator,
  ItemStatus,
  SyncQueueState,
  FetchState,
  Change,
  Result,
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

export function buildServerSnapshot<T extends { id: string }, C>(
  config: Config<T, C>,
): CollectionState<T, C> {
  const items = new Map<string, T>();
  if (config.serverItems) {
    for (const item of config.serverItems) {
      items.set(item.id, item);
    }
  }
  return {
    context: config.initialContext,
    items,
    syncState: "idle",
    loading: false,
    syncing: false,
    syncQueue: {
      queue: new Map(),
      inFlight: new Map(),
      errors: new Map(),
      isSyncing: false,
      isPaused: false,
    },
    fetchStatus: "idle",
    fetchError: undefined,
  };
}

export class Collection<T extends { id: string }, C> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static _cache = new Map<string, Collection<any, any>>();

  static get<T extends { id: string }, C>(config: Config<T, C>): Collection<T, C> {
    const existing = Collection._cache.get(config.id);
    if (existing) return existing as Collection<T, C>;
    const collection = new Collection(config);
    Collection._cache.set(config.id, collection);
    return collection;
  }

  static clear(id: string): void {
    Collection._cache.delete(id);
  }

  static clearAll(): void {
    Collection._cache.clear();
  }

  static getById<T extends { id: string }, C>(id: string): Collection<T, C> | undefined {
    return Collection._cache.get(id) as Collection<T, C> | undefined;
  }

  readonly id: string;
  readonly config: Config<T, C>;

  private _state: CollectionState<T, C>;
  private _syncQueue: SyncQueue<T, C>;
  private _fetchHandler: FetchHandler<T, C>;
  private _itemCache: WeakMap<T & object, Item<T, C>> = new WeakMap();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _nodeCache: WeakMap<TreeNode<any, any> & object, Node<any, C, any>> = new WeakMap();
  private _selectedNodeId: string | null = null;
  private _subscribers: Set<() => void> = new Set();
  private _hasInitialized = false;
  private _batchMode = false;

  constructor(config: Config<T, C>) {
    this.id = config.id;
    this.config = config;

    // Derive fetch/sync from unified handler
    const fetchFn = config.handler
      ? (ctx: C, signal: AbortSignal) =>
          config.handler!({ query: ctx }, signal).then((r) => r.results ?? [])
      : async () => [] as T[];

    const defaultSyncResult = (changes: Change<T>[]) =>
      fromPairs(map(changes, (c) => [c.id, { status: "success" as const }])) as Record<
        string,
        Result
      >;

    const syncFn = config.handler
      ? (changes: Change<T>[], _ctx: C, signal: AbortSignal) =>
          config.handler!({ changes }, signal).then(
            (r) => r.syncResults ?? defaultSyncResult(changes),
          )
      : async (changes: Change<T>[]) => defaultSyncResult(changes);

    this._syncQueue = new SyncQueue<T, C>({
      debounce: config.syncDebounce ?? 300,
      maxRetries: config.syncRetries ?? 3,
      getContext: () => this._state.context,
      onSync: syncFn,
    });

    this._fetchHandler = new FetchHandler<T, C>({
      id: config.id,
      cacheCapacity: config.cacheCapacity ?? 10,
      cacheTtl: config.cacheTtl ?? 60000,
      retries: config.fetchRetries ?? 0,
      onFetch: fetchFn,
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

    this._syncQueue.subscribe(() => this._onSyncQueueChange());
    this._fetchHandler.subscribe(() => this._onFetchChange());
    this._initialFetch();
  }

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

  subscribe(callback: () => void): () => void {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  getState(): CollectionState<T, C> {
    return this._state;
  }

  getItemStatus(id: string): ItemStatus {
    const { queue, inFlight, errors } = this._state.syncQueue;

    const inFlightChange = inFlight.get(id);
    if (inFlightChange) {
      return {
        type: inFlightChange.type,
        status: "syncing",
        retries: errors.get(id)?.retries ?? 0,
      };
    }

    const queuedChange = queue.get(id);
    if (queuedChange) {
      const errorInfo = errors.get(id);
      return {
        type: queuedChange.type,
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

  create(item: T): string {
    const { id } = item;

    this._state = create(this._state, (draft) => {
      draft.items.set(id, item as Draft<T>);
    });

    this._fetchHandler.invalidateCache();
    this._notifySubscribers();
    this._syncQueue.enqueue({ id, type: "create", data: item });
    return id;
  }

  update(id: string, mutate: (draft: Draft<T>) => void): void {
    const currentItem = this._state.items.get(id);
    if (!currentItem) return;

    const newItem = create(currentItem, mutate);

    this._state = create(this._state, (draft) => {
      set(newItem, "id", id); // ensure id is not changed
      draft.items.set(id, newItem as Draft<T>);
    });

    this._fetchHandler.invalidateCache();
    this._notifySubscribers();
    this._syncQueue.enqueue({ id, type: "update", data: newItem });
  }

  remove(id: string): void {
    const item = this._state.items.get(id);
    if (!item) return;

    this._state = create(this._state, (draft) => {
      draft.items.delete(id);
    });

    this._fetchHandler.invalidateCache();
    this._notifySubscribers();
    this._syncQueue.enqueue({ id, type: "delete", data: item });
  }

  getItem(id: string): Item<T, C> {
    const data = this._state.items.get(id);
    if (!data) return new Item(this, id);

    const dataAsObject = data as T & object;
    let item = this._itemCache.get(dataAsObject);
    if (!item) {
      item = new Item(this, id);
      this._itemCache.set(dataAsObject, item);
    }
    return item;
  }

  getNode<V extends object, NodeType = string>(id: string): Node<V, C, NodeType> {
    const data = this._state.items.get(id) as unknown as TreeNode<V, NodeType> | undefined;
    if (!data) {
      return new Node(this as unknown as Collection<TreeNode<V, NodeType>, C>, id);
    }

    const dataAsObject = data as TreeNode<V, NodeType> & object;
    let node = this._nodeCache.get(dataAsObject) as Node<V, C, NodeType> | undefined;
    if (!node) {
      node = new Node(this as unknown as Collection<TreeNode<V, NodeType>, C>, id);
      this._nodeCache.set(dataAsObject, node);
    }
    return node;
  }

  batch(fn: () => void): void {
    const wasBatching = this._batchMode;
    this._batchMode = true;
    try {
      fn();
    } finally {
      this._batchMode = wasBatching;
      if (!wasBatching) this._notifySubscribers();
    }
  }

  selectNode(id: string): void {
    if (this._selectedNodeId !== id) {
      this._selectedNodeId = id;
      this._notifySubscribers();
    }
  }

  deselectNode(): void {
    if (this._selectedNodeId !== null) {
      this._selectedNodeId = null;
      this._notifySubscribers();
    }
  }

  get selectedNodeId(): string | null {
    return this._selectedNodeId;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get selectedNode(): Node<any, C> | null {
    return this._selectedNodeId ? this.getNode(this._selectedNodeId) : null;
  }

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

  async refresh(): Promise<void> {
    this._fetchHandler.invalidateCache();
    await this._fetchHandler.fetch(this._state.context);
  }

  pauseSync(): void {
    this._syncQueue.pause();
  }

  resumeSync(): void {
    this._syncQueue.resume();
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

  destroy(): void {
    this._syncQueue.destroy();
    this._fetchHandler.destroy();
    this._subscribers.clear();
    Collection._cache.delete(this.id);
  }

  private async _initialFetch(): Promise<void> {
    if (this._hasInitialized) return;
    this._hasInitialized = true;

    if (this.config.serverItems) {
      this._state = create(this._state, (draft) => {
        for (const item of this.config.serverItems!) {
          draft.items.set(item.id, item as Draft<T>);
        }
      });
      this._notifySubscribers();
      return;
    }

    if (typeof window === "undefined") return;

    await this._fetchHandler.fetch(this._state.context);
  }

  private _onSyncQueueChange(): void {
    this._updateSyncState(this._syncQueue.getState());
  }

  private _onFetchChange(): void {
    const fetchState = this._fetchHandler.getState();

    this._state = create(this._state, (draft) => {
      draft.fetchStatus = fetchState.status;
      draft.fetchError = fetchState.error;
      draft.loading = fetchState.status === "fetching";
      draft.syncState = this._computeSyncState(fetchState.status, draft.syncQueue.isSyncing);

      const newItems = new Map<string, Draft<T>>();

      for (const item of fetchState.items) {
        newItems.set(item.id, item as Draft<T>);
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
    if (fetchStatus === "fetching") return "fetching";
    if (isSyncing) return "syncing";
    return "idle";
  }

  private _notifySubscribers(): void {
    if (this._batchMode) return;
    for (const callback of this._subscribers) {
      callback();
    }
  }
}
