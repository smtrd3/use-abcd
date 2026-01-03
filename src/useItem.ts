import { useSyncExternalStore, useCallback, useEffect } from "react";
import type { Draft } from "mutative";
import type { Item } from "./item";
import type { ItemStatus } from "./types";

export type UseItemResult<T> = {
  data: T | undefined;
  status: ItemStatus;
  update: (mutate: (draft: Draft<T>) => void) => void;
  remove: () => void;
  exists: boolean;
};

export function useItem<T, C>(item: Item<T, C>): UseItemResult<T> {
  // Release item reference on unmount
  // Use queueMicrotask to defer release, allowing React StrictMode's
  // rapid unmount→remount cycle to balance retain/release properly
  useEffect(() => {
    return () => {
      queueMicrotask(() => item._release());
    };
  }, [item]);

  const data = useSyncExternalStore(
    (callback) => item.collection.subscribe(callback),
    () => item.data,
    () => item.data,
  );

  const status = useSyncExternalStore(
    (callback) => item.collection.subscribe(callback),
    () => item.getStatus(),
    () => item.getStatus(),
  );

  const exists = useSyncExternalStore(
    (callback) => item.collection.subscribe(callback),
    () => item.exists(),
    () => item.exists(),
  );

  const update = useCallback((mutate: (draft: Draft<T>) => void) => item.update(mutate), [item]);

  const remove = useCallback(() => item.remove(), [item]);

  return { data, status, update, remove, exists };
}
