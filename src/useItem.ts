import { useSyncExternalStore, useCallback } from "react";
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

export function useItem<T extends { id: string }, C>(
  item: Item<T, C>,
  options?: { trackStatus?: boolean },
): UseItemResult<T> {
  const trackStatus = options?.trackStatus ?? true;

  const data = useSyncExternalStore<T | undefined>(
    (callback) => item.collection.subscribe(callback),
    () => item.data,
    () => item.data,
  );

  const status = useSyncExternalStore<ItemStatus>(
    trackStatus ? (callback) => item.collection.subscribe(callback) : noopSubscribe,
    trackStatus ? () => item.getStatus() : noopStatus,
    trackStatus ? () => item.getStatus() : noopStatus,
  );

  const exists = useSyncExternalStore<boolean>(
    (callback) => item.collection.subscribe(callback),
    () => item.exists(),
    () => item.exists(),
  );

  const update = useCallback((mutate: (draft: Draft<T>) => void) => item.update(mutate), [item]);

  const remove = useCallback(() => item.remove(), [item]);

  return { data, status, update, remove, exists };
}

const noopSubscribe = () => () => {};
const noopStatus = (): ItemStatus => null;
