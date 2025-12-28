import { useSyncExternalStore } from "react";
import type { Draft } from "mutative";
import { Collection } from "./collection";
import type { Config, Mutator } from "./types";

// Re-export types for public use
export type {
  Config,
  Change,
  SyncResult,
  ItemStatus,
  SyncQueueState,
  SyncState,
  ChangeType,
  ItemSyncStatus,
} from "./types";

export function useCrud<T, C>(config: Config<T, C>) {
  const collection = Collection.get(config);

  const state = useSyncExternalStore(
    (callback) => collection.subscribe(callback),
    () => collection.getState(),
    () => collection.getState(),
  );

  return {
    // State (all from single immutable state object)
    items: state.items,
    context: state.context,
    syncState: state.syncState,
    syncQueue: state.syncQueue,
    loading: state.loading,
    syncing: state.syncing,

    // Item operations
    create: (item: T) => collection.create(item),
    update: (id: string, mutate: (draft: Draft<T>) => void) => collection.update(id, mutate),
    remove: (id: string) => collection.remove(id),
    getItem: (id: string) => collection.getItem(id),
    getItemStatus: (id: string) => collection.getItemStatus(id),

    // Context & refresh
    setContext: (patchContext: Mutator<C>) => collection.setContext(patchContext),
    refresh: () => collection.refresh(),

    // Sync controls
    pauseSync: () => collection.pauseSync(),
    resumeSync: () => collection.resumeSync(),
    retrySync: (id?: string) => collection.retrySync(id),
  };
}
