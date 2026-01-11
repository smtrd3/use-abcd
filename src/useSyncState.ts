import { useSyncExternalStore } from "react";
import { Collection } from "./collection";
import type { SyncState, Change, SyncError } from "./types";

export type UseSyncStateResult<T = unknown> = {
  syncState: SyncState;
  syncing: boolean;
  queue: Map<string, Change<T>[]>;
  inFlight: Map<string, Change<T>[]>;
  errors: Map<string, SyncError<T>>;
  isPaused: boolean;
  isSyncing: boolean;
};

/**
 * Hook for accessing the sync state of a collection by ID.
 *
 * Use this when you need to display sync status in a component that
 * doesn't have access to the full useCrud hook.
 *
 * @param collectionId - The ID of the collection
 * @returns Flat object with syncState and all syncQueue properties
 */
export function useSyncState<T = unknown>(collectionId: string): UseSyncStateResult<T> {
  const collection = Collection.getById(collectionId);
  if (!collection) {
    throw new Error(
      `Collection with id "${collectionId}" not found. Make sure useCrud is called first.`,
    );
  }

  const state = useSyncExternalStore(
    (cb) => collection.subscribe(cb),
    () => collection.getState(),
    () => collection.getState(),
  );

  return {
    syncState: state.syncState,
    syncing: state.syncing,
    queue: state.syncQueue.queue as Map<string, Change<T>[]>,
    inFlight: state.syncQueue.inFlight as Map<string, Change<T>[]>,
    errors: state.syncQueue.errors as Map<string, SyncError<T>>,
    isPaused: state.syncQueue.isPaused,
    isSyncing: state.syncQueue.isSyncing,
  };
}
