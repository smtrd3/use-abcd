import { useMemo, useSyncExternalStore } from "react";
import type { Draft } from "mutative";
import { ulid } from "ulid";
import { Collection, buildServerSnapshot } from "./collection";
import type { Config, Mutator } from "./types";

export type {
  Config,
  CrudHandler,
  Change,
  Result,
  ItemStatus,
  SyncQueueState,
  SyncState,
  ChangeType,
  ItemSyncStatus,
  FetchState,
} from "./types";

export function useCrud<T extends { id: string }, C>(config: Config<T, C>) {
  const collection = Collection.get(config);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const serverSnapshot = useMemo(() => buildServerSnapshot(config), [config.id]);

  const state = useSyncExternalStore(
    (callback) => collection.subscribe(callback),
    () => collection.getState(),
    () => serverSnapshot,
  );

  return {
    // State
    items: state.items,
    context: state.context,
    syncState: state.syncState,
    syncQueue: state.syncQueue,
    loading: state.loading,
    syncing: state.syncing,
    fetchStatus: state.fetchStatus,
    fetchError: state.fetchError,

    // Item operations
    create: (item: Omit<T, "id">) => collection.create({ ...item, id: ulid() } as T),
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
