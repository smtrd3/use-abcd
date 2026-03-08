import { useSyncExternalStore } from "react";
import { Collection, type CollectionState } from "./collection";

/**
 * Hook for accessing the serverState of a collection by ID.
 *
 * Use this when you need server-provided metadata (e.g., totals, pagination cursors)
 * in a component that doesn't have access to the full useCrud hook.
 *
 * @param collectionId - The ID of the collection
 * @param defaultValue - Value returned when serverState is undefined
 * @returns The serverState cast to T, or the defaultValue
 */
export function useServerState<T>(collectionId: string, defaultValue: T): T {
  const collection = Collection.getById(collectionId);
  if (!collection) {
    throw new Error(
      `Collection with id "${collectionId}" not found. Make sure useCrud is called first.`,
    );
  }

  const state = useSyncExternalStore<CollectionState<{ id: string }, unknown>>(
    (cb) => collection.subscribe(cb),
    () => collection.getState(),
    () => collection.getState(),
  );

  return (state.serverState as T) ?? defaultValue;
}
