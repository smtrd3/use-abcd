/* eslint-disable @typescript-eslint/no-explicit-any */
// biome-ignore assist/source/organizeImports: self managed
import { identity, isEqual, set, size, some } from "lodash-es";
import { create, type Draft } from "mutative";
import { nanoid } from "nanoid";
import { useRef, useMemo, useCallback, useSyncExternalStore, useEffect } from "react";

export type Item = { id: string } & Record<string, any>;

export type TransitionStates = "create" | "update" | "delete" | "idle" | "error" | "changed";

export type ItemWithState<T extends Item = Item> = {
  data: T;
  state: TransitionStates;
  optimistic: boolean;
  errors: string[];
  action?: [TransitionStates, T];
};

export type QueryOption = {
  signal: AbortSignal;
  context: unknown;
};

export type FetchFn<T extends Item = Item> = (
  option: QueryOption
) => Promise<{ items: T[]; metadata: unknown }>;

export type TransitionFn<T extends Item = Item> = (
  item: Partial<T>,
  option: QueryOption
) => Promise<{ id: string }>;

export type Updater<T> = (updatable: T) => void;

export type StoreState<T extends Item = Item, C extends object = object> = {
  context: C,
  items: Map<string, ItemWithState<T>>;
  fetchState: { isLoading: boolean; errors: string[]; metadata?: unknown };
};

type CachedItem = { data: unknown; ts: number };

/**
 * Cache implementation for storing and managing fetch results
 * with configurable age and capacity limits.
 */
export class FetchCache {
  age: number = 0;
  capacity: number = 0;
  storage: Map<string, CachedItem> = new Map();

  constructor(age: number = 0, capacity: number = 0) {
    this.age = age;
    this.capacity = capacity;
  }

  invalidate() {
    this.storage.clear();
  }

  reset(age: number, capacity: number) {
    this.invalidate();
    this.age = age;
    this.capacity = capacity;
  }

  get(id: string) {
    if (this.capacity === 0) return;
    const cachedItem = this.storage.get(id);
    if (cachedItem) {
      const age = Date.now() - cachedItem.ts;
      if (age > this.age) {
        this.storage.delete(id);
        return;
      } else {
        return cachedItem.data;
      }
    }
    return;
  }

  put(id: string, item: unknown) {
    if (this.capacity > 0) {
      this.storage.set(id, { data: item, ts: Date.now() });
    }
    if (this.storage.size > this.capacity) {
      const delKey = [...this.storage.keys()].at(0);
      this.storage.delete(delKey);
    }
  }

  remove(id: string) {
    this.storage.delete(id);
  }

  withCache = async (id: string, callback: () => Promise<unknown>) => {
    const cachedItem = this.get(id);
    if (cachedItem) {
      return cachedItem;
    }

    return callback().then((response) => {
      this.put(id, response);
      return response;
    });
  };
}

/**
 * Core state management store for CRUD operations.
 * Handles data fetching, caching, and state transitions for items.
 * @template T - Type of items managed by the store, must extend Item base type
 */
class Store<T extends Item = Item, C extends object = object> {
  batched = false;
  state: StoreState<T, C> = {
    items: new Map(),
    context: {} as C,
    fetchState: {
      isLoading: false,
      errors: [],
      metadata: {},
    },
  };
  subscribers: Set<() => void> = new Set();
  controllers: Map<string, AbortController> = new Map();
  fetchController: AbortController = new AbortController();
  fetchCache: FetchCache = new FetchCache();

  constructor(private id: string = "<none>", private config: CrudConfig<T, C>) {
    this.setItems([]); // need to figure out how to set the initial items

    const { caching: { age = 0, capacity = 0 } = { age: 0, capacity: 0 }, context } = config;
    this.state.context = context;
    this.fetchCache.reset(age, capacity);
  }

  private getCacheKey() {
    const { context } = this.state;
    return `[${this.id}, ${JSON.stringify(context)}]`;
  }

  customLog = (title: string = "log", ...messages: any[]) => {
    if (import.meta.env.DEV) {
      console.groupCollapsed(`[useCrud]#${this.id} ${title}`);
      console.log(...messages);
      console.groupEnd();
    }
  };

  wait = (ms: number, signal: AbortSignal) => {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.customLog("delay", "Fetch operation canceled due to debounce re-entry");
        reject("DEBOUNCE_CANCELLED");
      };

      signal.addEventListener("abort", onAbort);
      setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve("");
      }, ms);
    });
  };

  private batch = (fn: () => void) => {
    this.batched = true;
    fn();
    this.batched = false;
    this.notify();
  };

  private setItems = (items: T[]) => {
    const map: Map<string, ItemWithState<T>> = new Map();
    items.forEach((item) => {
      map.set(item.id, {
        data: item,
        state: "idle",
        optimistic: false,
        errors: [],
      });
    });

    this.state = create(this.state, (draftState) => {
      draftState.items = map as any;
    });

    this.notify();
  };

  private setMetadata = (metadata: unknown) => {
    this.state = create(this.state, (draftState) => {
      draftState.fetchState.metadata = metadata;
    });
    this.notify();
  };

  public setContext = (context: C) => {
    this.state = create(this.state, draft => {
      draft.context = context as Draft<C>;
    });

    this.executeFetch();
  };

  private remove = (id: string) => {
    this.state = create(this.state, (draftState) => {
      draftState.items.delete(id);
    });

    this.notify();
  };

  private updateItem = (data: Item) => {
    this.state = create(this.state, (draftState) => {
      const selectedItem = draftState.items.get(data.id);
      if (selectedItem) {
        set(selectedItem, "data", data);
        this.notify();
      }
    });
  };

  public clearFetchCache = () => {
    this.fetchCache.remove(this.getCacheKey());
  };

  private startFetch = () => {
    this.fetchController.abort();
    this.state = create(this.state, (state) => {
      state.fetchState.isLoading = true;
    });
    this.fetchController = new AbortController();
    this.notify();
  };

  private endFetch = (errors: string[] = []) => {
    this.state = create(this.state, (state) => {
      state.fetchState.isLoading = false;
      state.fetchState.errors = errors;
    });
    this.notify();
  };

  executeFetch = async () => {
    const { context } = this.state;
    const { fetch: fetchFn } = this.config;
    const cacheKey = this.getCacheKey();
    this.startFetch();
    try {
      let response: Awaited<ReturnType<FetchFn<T>>> | null = null;

      if (fetchFn) {
        response = (await this.fetchCache.withCache(cacheKey, async () => {
          await this.wait(this.config.debounce || 0, this.fetchController.signal);
          this.customLog("fetch execution", "Executing fetch function");
          return fetchFn({
            signal: this.fetchController.signal,
            context,
          });
        })) as Awaited<ReturnType<FetchFn<T>>>;
      } else {
        response = { items: [] as T[], metadata: {} as unknown };
      }

      this.batch(() => {
        this.setItems(response.items);
        this.setMetadata(response.metadata);
        this.endFetch();
      });
    } catch (ex) {
      if (ex === "DEBOUNCE_CANCELLED") {
        return;
      }

      if ((ex as Error).name === "AbortError") {
        this.customLog("fetch exception", "Fetch operation was cancelled by client");
        this.endFetch();
        return;
      }

      this.batch(() => {
        this.endFetch([ex.message]);
        this.setItems([]);
      });
    }
  };

  executeRemove = async (input: T) => {
    const { context } = this.state;
    const { create: save } = this.config;
    const controller = this.startTransition({
      id: input.id,
      input: input,
      state: "delete",
    });

    if (save) {
      try {
        await save(input, { signal: controller.signal, context });
        this.remove(input.id);
        this.startTransition({ id: input.id, state: "idle" });
      } catch (ex) {
        if ((ex as Error).name === "AbortError") {
          // On abort, first clean up any existing operation
          this.controllers.delete(input.id);

          // Then reset state to idle
          this.state = create(this.state, (draft) => {
            const item = draft.items.get(input.id);
            if (item) {
              item.state = "idle";
              item.action = undefined;
              item.errors = [];
            }
          });
          this.notify();
          throw ex; // Re-throw to signal the operation was aborted
        }

        this.startTransition({
          id: input.id,
          input: input,
          state: "delete",
          errors: [(ex as Error).message],
        });
      }
    } else {
      this.remove(input.id);
      this.startTransition({ id: input.id, state: "idle" });
    }

    this.fetchCache.remove(this.getCacheKey());
  };

  executeUpdate = async (
    item: T,
    updater: Updater<T> = identity,
    isOptimistic = false,
    noSave = false,
  ) => {
    const { context } = this.state;
    const { update: save } = this.config;
    const itemId = item.id;
    if (this.state.items.has(itemId)) {
      const item = this.state.items.get(itemId).data;
      const updatedItem = create(item, updater);
      const controller = this.startTransition({
        id: itemId,
        input: updatedItem,
        state: "update",
        isOptimistic,
      });

      if (isOptimistic) {
        this.updateItem(updatedItem);
      }

      if (save && !noSave) {
        try {
          await save(updatedItem, { signal: controller.signal, context });
          this.updateItem(updatedItem);
          this.startTransition({ id: itemId, state: "idle" });
        } catch (ex: unknown) {
          if ((ex as Error).name === "AbortError") {
            this.updateItem(item); // revert to original item
            this.startTransition({ id: updatedItem.id, state: "idle" });
            return;
          }

          this.startTransition({
            id: itemId,
            input: updatedItem,
            state: "error",
            errors: [(ex as Error).message],
          });
        }
      } else {
        this.updateItem(updatedItem);
        this.startTransition({ id: itemId, state: !noSave ? "changed" : "idle" });
      }

      this.fetchCache.remove(this.getCacheKey());
    }
  };

  executeCreate = async (input: T) => {
    const { context } = this.state;
    const { create: save } = this.config;
    const randomId = `create_${nanoid(8)}`;
    const inputWithId = { ...input, id: randomId };

    const append = (id?: string) => {
      this.state = create(this.state, (draftState) => {
        const itemWithState: ItemWithState<T> = {
          data: { ...input, id: id || randomId },
          errors: [],
          optimistic: true, // always true for create
          state: "create",
          action: ["create", inputWithId],
        };

        draftState.items.set(id || randomId, itemWithState as any);
      });

      this.notify();
    };

    // by design always append
    append();
    const controller = this.startTransition({
      id: randomId,
      input: inputWithId,
      state: "create",
      isOptimistic: true,
      errors: [],
    });

    if (save) {
      try {
        const { id: savedId } = await save(input, {
          signal: controller.signal,
          context,
        });

        // handle optimistic case
        if (this.state.items.has(randomId)) {
          const newItems: Map<string, ItemWithState<T>> = new Map();
          this.state.items.forEach((value, key) => {
            if (key === randomId) {
              newItems.delete(randomId);
              newItems.set(savedId, {
                ...value,
                data: { ...value.data, id: savedId },
              });
            } else {
              newItems.set(key, value);
            }
          });

          this.state = create(this.state, (draftState) => {
            draftState.items = newItems as any;
          });

          this.startTransition({ id: savedId, state: "idle" });
        } else {
          append(savedId);
          this.startTransition({ id: savedId, state: "idle" });
        }
      } catch (ex) {
        if ((ex as Error).name === "AbortError") {
          this.remove(randomId);
          this.startTransition({ id: input.id, state: "idle" });
          return;
        }

        this.startTransition({
          id: randomId,
          input: inputWithId,
          state: "create",
          errors: [(ex as Error).message],
        });
      }
    } else {
      append();
      this.startTransition({ id: randomId, state: "idle" });
    }

    this.fetchCache.remove(this.getCacheKey());
  };

  startTransition = ({
    id,
    input = undefined,
    state,
    isOptimistic = false,
    errors = [],
  }: {
    id: string;
    input?: T;
    state: ItemWithState<T>["state"];
    isOptimistic?: boolean;
    errors?: string[];
  }) => {
    const controller = new AbortController();
    if (this.state.items.has(id)) {
      this.controllers.get(id)?.abort();
      this.controllers.set(id, controller);
      this.state = create(this.state, (draft) => {
        const draftItem = draft.items.get(id) as ItemWithState<T>;
        draftItem.state = state;
        draftItem.optimistic = isOptimistic;
        draftItem.errors = state === "idle" ? [] : errors;
        draftItem.action = state === "idle" ? undefined : [state, input];
      });
      this.notify();
    }

    return controller;
  };

  cancelFetch = () => {
    this.fetchController.abort();
  };

  cancelOperation = (id: string) => {
    this.controllers.get(id)?.abort();
  };

  private notify = () => {
    this.subscribers.forEach((fn) => {
      fn();
    });
  };

  getSnapshot = () => {
    return this.state;
  };

  subscribe = (fn: () => void) => {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  };

  static instances: Map<string, Store<any>> = new Map();
  static createStore<T extends Item = Item, C extends object = object>(config: CrudConfig<T, C>): Store<T> {
    const { id } = config;
    if (Store.instances.has(id)) {
      return Store.instances.get(id);
    }

    Store.instances.set(id, new Store(id, config));
    return Store.instances.get(id);
  }
}

export const useMemoDeepEquals = <T>(value: T) => {
  const valueRef = useRef(value);

  return useMemo(() => {
    if (!isEqual(value, valueRef.current)) {
      valueRef.current = value;
    }
    return valueRef.current;
  }, [value]);
};

export type CrudConfig<T extends Item = Item, C extends object = object> = {
  id: string;
  context: C;
  debounce?: number;
  caching?: {
    capacity: number; // capacity is in pages
    age: number;
  };
  fetch?: FetchFn<T>;
  create?: TransitionFn<T>;
  update?: TransitionFn<T>;
  remove?: TransitionFn<T>;
  getServerSnapshot?: () => StoreState<T>;
};

/**
 * Hook that provides CRUD operation handlers for managing items.
 * @template T - Type of items to manage, must extend Item base type
 * @template C - Type of context object used in operations
 * @param config - Configuration object for CRUD operations
 * @returns Object containing CRUD operation handlers and cancellation functions
 */
export function useCrudOperations<T extends Item = Item>(id: string) {
  const store = Store.instances.get(id);

  const fetch = useCallback(() => {
    store?.executeFetch();
  }, [store]);

  const refetch = useCallback(() => {
    store.clearFetchCache();
    store.executeFetch();
  }, [store]);

  const cancelFetch = useCallback(() => {
    store.cancelFetch();
  }, [store]);

  const cancelOperation = useCallback(
    (id: string) => {
      store.cancelOperation(id);
    },
    [store]
  );

  const create = useCallback((item: Partial<T>) => {
    store.executeCreate(item);
  }, [store]);

  return {
    fetch,
    refetch,
    create,
    cancelFetch,
    cancelOperation,
  };
}

/**
 * Main hook for managing CRUD operations with automatic state management.
 * Provides access to items, metadata, loading states, and CRUD operations.
 * @template T - Type of items to manage, must extend Item base type
 * @template C - Type of context object used in operations
 * @param config - Configuration object for CRUD operations
 * @returns Object containing items, state information, and CRUD operation handlers
 */
export function useCrud<T extends Item = Item, C extends Record<string, any> = any>(
  config: CrudConfig<T, C>
) {
  const store = Store.createStore(config);
  const { fetch, create, cancelOperation, cancelFetch } =
    useCrudOperations(config.id);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, config.getServerSnapshot);
  const memoContext = useMemoDeepEquals(config.context);

  useEffect(() => {
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id, memoContext]);

  const items = useMemo(() => [...state.items.values()], [state.items]);

  const snapshot = useMemo(
    () => ({
      itemsById: state.items,
      items,
      metadata: state.fetchState.metadata,
      isLoading: state.fetchState.isLoading,
      hasError: size(state.fetchState.errors) > 0 || some(items, (item) => item.errors.length > 0),
      errors: state.fetchState.errors,
      create,
      cancelFetch,
      cancelOperation,
    }),
    [
      state.items,
      state.fetchState.metadata,
      state.fetchState.isLoading,
      state.fetchState.errors,
      items,
      create,
      cancelFetch,
      cancelOperation,
    ]
  );

  store.customLog("snapshot", snapshot);
  return snapshot;
}

export function useItemState<T extends Item = Item>(storeId: string, item: ItemWithState<T>):
  [T, {
    errors: string[],
    state: TransitionStates,
    change: (cb: Updater<T>) => void,
    save: () => void,
    update: (cb: Updater<T>) => void,
    remove: () => void,
    retryLast: () => void,
    cancel: () => void,
  }] {
  const store = Store.instances.get(storeId) as Store;
  const data = useMemo(() => item.data, [item.data]);

  const update = useCallback((cb: Updater<T>) => {
    store.executeUpdate(data, cb);
  }, [data, store]);

  const remove = useCallback(() => {
    store.executeRemove(data);
  }, [data, store]);

  const change = useCallback((cb: Updater<T>) => {
    store.executeUpdate(data, cb, true, true);
  }, [data, store]);

  const save = useCallback(() => {
    store.executeUpdate(data, identity, false);
  }, [data, store]);

  const cancel = useCallback(() => {
    store.cancelOperation(data.id);
  }, [store, data.id]);

  const retryLast = useCallback(
    () => {
      if (item.action) {
        const [state, input] = item.action;

        switch (state) {
          case "create":
            store.executeCreate(input);
            break;
          case "delete":
            store.executeRemove(input);
            break;
          case "update":
            store.executeUpdate(input);
            break;
        }
      }
    },
    [item, store]
  );

  return [
    data,
    {
      errors: item.errors,
      state: item.state,
      change,
      save,
      update,
      remove,
      retryLast,
      cancel
    }];
}