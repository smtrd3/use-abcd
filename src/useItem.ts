import { useSyncExternalStore, useCallback, useMemo } from "react";
import type { Draft } from "mutative";
import { Collection } from "./collection";
import { Item } from "./item";
import type { ItemStatus } from "./types";

export type UseItemResult<T> = {
  data: T | undefined;
  status: ItemStatus;
  update: (mutate: (draft: Draft<T>) => void) => void;
  remove: () => void;
  exists: boolean;
};

/**
 * Hook to subscribe to and manage a single item in a collection.
 *
 * @overload
 * @param collectionId - The collection ID
 * @param itemId - The item ID within the collection
 *
 * @overload
 * @param item - An Item instance (for backward compatibility)
 */
export function useItem<T extends object>(collectionId: string, itemId: string): UseItemResult<T>;
export function useItem<T extends object, C>(item: Item<T, C>): UseItemResult<T>;
export function useItem<T extends object, C>(
  collectionIdOrItem: string | Item<T, C>,
  itemId?: string,
): UseItemResult<T> {
  // Resolve collection and item
  const { collection, resolvedItemId } = useMemo(() => {
    if (typeof collectionIdOrItem === "string") {
      // Called with (collectionId, itemId)
      const coll = Collection.getById<T, C>(collectionIdOrItem);
      if (!coll) {
        throw new Error(
          `Collection "${collectionIdOrItem}" not found. Make sure useCrud is called first.`,
        );
      }
      return { collection: coll, resolvedItemId: itemId! };
    }
    // Called with Item instance
    return { collection: collectionIdOrItem.collection, resolvedItemId: collectionIdOrItem.id };
  }, [collectionIdOrItem, itemId]);

  // Get stable Item reference from collection
  const item = useMemo(() => collection.getItem(resolvedItemId), [collection, resolvedItemId]);

  const data = useSyncExternalStore(
    (callback) => collection.subscribe(callback),
    () => item.data,
    () => item.data,
  );

  const status = useSyncExternalStore(
    (callback) => collection.subscribe(callback),
    () => item.getStatus(),
    () => item.getStatus(),
  );

  const exists = useSyncExternalStore(
    (callback) => collection.subscribe(callback),
    () => item.exists(),
    () => item.exists(),
  );

  const update = useCallback((mutate: (draft: Draft<T>) => void) => item.update(mutate), [item]);

  const remove = useCallback(() => item.remove(), [item]);

  return { data, status, update, remove, exists };
}
