/* eslint-disable @typescript-eslint/no-explicit-any */
import { isEqual, map, set, size, some } from "lodash-es";
import { create } from "mutative";
import { nanoid } from "nanoid";
import { useRef, useMemo, useCallback, useSyncExternalStore, useEffect } from "react";

export type Item = { id: string } & Record<string, unknown>;

export type ItemWithState<T extends Item = Item> = {
  data: T;
  state: "create" | "update" | "delete" | "complete" | "error";
  optimistic: boolean;
  errors: string[];
  input?: T;
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

export type StoreOptions<T extends Item = Item> = {
  initialData?: T[];
} & Pick<CrudConfig, "caching" | "debounce">;

export type StoreState<T extends Item = Item> = {
  fetchState: { isLoading: boolean; errors: string[]; metadata?: unknown };
  items: Map<string, ItemWithState<T>>;
};

export type CreateStoreConfig<T extends Item = Item> = {
  id: string;
  initialData?: T[];
  debounce?: number;
  caching?: {
    capacity: number;
    age: number;
  };
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
    if (this.storage.capacity > this.capacity) {
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

function delay(ms: number, signal: AbortSignal) {
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject("DEBOUNCE_CANCELLED");
    });
    setTimeout(resolve, ms);
  });
}

/**
 * Core state management store for CRUD operations.
 * Handles data fetching, caching, and state transitions for items.
 * @template T - Type of items managed by the store, must extend Item base type
 */
class Store<T extends Item = Item> {
  id: string = "<none>";
  batched = false;
  state: StoreState<T> = {
    items: new Map(),
    fetchState: {
      isLoading: false,
      errors: [],
      metadata: {},
    },
  };
  options: StoreOptions<T> = { initialData: [] };
  subscribers: Set<() => void> = new Set();
  controllers: Map<string, AbortController> = new Map();
  fetchController: AbortController = new AbortController();
  fetchCache: FetchCache = new FetchCache();

  constructor(id: string, options: StoreOptions<T> = { initialData: [] }) {
    this.id = id;
    this.options = options;
    const { initialData = [], caching } = options;
    this.setItems(initialData);
    this.fetchCache.reset(caching?.age || 0, caching?.capacity || 0);
  }

  private getCacheKey(context: unknown) {
    return `[${this.id}, ${JSON.stringify(context)}]`;
  }

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
        state: "complete",
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

  clearFetchCache = (context: unknown) => {
    this.fetchCache.remove(this.getCacheKey(context));
  };

  private startFetch = () => {
    console.log("Start fetch");
    this.fetchController.abort();
    this.state = create(this.state, (state) => {
      state.fetchState.isLoading = true;
    });
    this.fetchController = new AbortController();
    this.notify();
  };

  private endFetch = (errors: string[] = []) => {
    console.log("End fetch");
    this.state = create(this.state, (state) => {
      state.fetchState.isLoading = false;
      state.fetchState.errors = errors;
    });
    this.notify();
  };

  executeFetch = async <Context extends Record<string, unknown>>(
    context: Context,
    fetchFn: FetchFn<T>
  ) => {
    const cacheKey = this.getCacheKey(context);
    this.startFetch();
    try {
      let response: Awaited<ReturnType<FetchFn<T>>> | null = null;

      if (fetchFn) {
        response = (await this.fetchCache.withCache(cacheKey, async () => {
          await delay(this.options.debounce || 0, this.fetchController.signal);
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
        this.endFetch();
        return;
      }

      this.batch(() => {
        this.endFetch([ex.message]);
        this.setItems([]);
      });
    }
  };

  executeRemove = async (input: T, context: unknown, save?: TransitionFn<T>) => {
    const controller = this.startTransition({ id: input.id, input, state: "delete" });

    if (save) {
      try {
        await save(input, { signal: controller.signal, context });
        this.remove(input.id);
        this.startTransition({ id: input.id, state: "complete" });
      } catch (ex) {
        if ((ex as Error).name === "AbortError") {
          this.startTransition({ id: input.id, state: "complete" });
          return;
        }

        this.startTransition({
          id: input.id,
          input,
          state: "delete",
          errors: [(ex as Error).message],
        });
      }
    } else {
      this.remove(input.id);
      this.startTransition({ id: input.id, state: "complete" });
    }

    this.fetchCache.remove(this.getCacheKey(context));
  };

  executeUpdate = async (
    item: T,
    context: unknown,
    updater: Updater<T>,
    save?: TransitionFn<T>,
    isOptimistic = false
  ) => {
    const itemId = item.id;
    if (this.state.items.has(itemId)) {
      const item = this.state.items.get(itemId) as ItemWithState<T>;
      const updatedItem = create(item.data, updater);
      const controller = this.startTransition({
        id: itemId,
        input: updatedItem,
        state: "update",
        isOptimistic,
      });

      if (isOptimistic) {
        this.updateItem(updatedItem);
      }

      if (save) {
        try {
          await save(updatedItem, { signal: controller.signal, context });
          this.updateItem(updatedItem);
          this.startTransition({ id: itemId, state: "complete" });
        } catch (ex: unknown) {
          if ((ex as Error).name === "AbortError") {
            this.updateItem(item.data); // revert to original item
            this.startTransition({ id: updatedItem.id, state: "complete" });
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
        this.startTransition({ id: itemId, state: "complete" });
      }

      this.fetchCache.remove(this.getCacheKey(context));
    }
  };

  executeCreate = async (context: unknown, input: T, save?: TransitionFn<T>) => {
    const randomId = `create_${nanoid(8)}`;
    const inputWithId = { ...input, id: randomId };

    const append = (id?: string) => {
      this.state = create(this.state, (draftState) => {
        const itemWithState: ItemWithState<T> = {
          data: { ...input, id: id || randomId },
          errors: [],
          optimistic: true, // always true for create
          state: "create",
          input: inputWithId,
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

          this.startTransition({ id: savedId, state: "complete" });
        } else {
          append(savedId);
          this.startTransition({ id: savedId, state: "complete" });
        }
      } catch (ex) {
        if ((ex as Error).name === "AbortError") {
          this.remove(randomId);
          this.startTransition({ id: input.id, state: "complete" });
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
      this.startTransition({ id: randomId, state: "complete" });
    }

    this.fetchCache.remove(this.getCacheKey(context));
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
        draftItem.errors = state === "complete" ? [] : errors;
        draftItem.input = state == "complete" ? undefined : input;
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
  static createStore<T extends Item = Item>(config: CreateStoreConfig<T>): Store<T> {
    const { id, caching = { age: 0, capacity: 0 }, debounce = 0, initialData = [] } = config;
    if (Store.instances.has(id)) {
      return Store.instances.get(id);
    }

    Store.instances.set(id, new Store(id, { initialData, caching, debounce }));
    return Store.instances.get(id);
  }
}

export type CrudConfig<T extends Item = Item, C = any> = {
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
export function useCrudOperations<T extends Item = Item, C extends Record<string, any> = any>(
  config: CrudConfig<T, C>
) {
  const configRef = useRef(config);
  const context = useMemo(() => {
    if (!isEqual(config.context, configRef.current.context)) {
      configRef.current = config;
    }
    return configRef.current.context;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id, config.context]);

  const getStore = useCallback(() => {
    const store = Store.instances.get(config.id);
    if (!store) {
      console.error("Store not found, are you sure you used useCrud with config id = ", config.id);
    }
    return store;
  }, [config.id]);

  const fetch = useCallback(() => {
    const store = getStore();
    store?.executeFetch(context, configRef.current.fetch);
  }, [context, getStore]);

  const refetch = useCallback(() => {
    const store = getStore();
    store.clearFetchCache(context);
    store.executeFetch(context, configRef.current.fetch);
  }, [context, getStore]);

  const create = useCallback(
    (item: Omit<T, "id">, isOptimistic = false) => {
      const store = getStore();
      store.executeCreate(context, item as T, configRef.current.create, isOptimistic);
    },
    [context, getStore]
  );

  const update = useCallback(
    (item: T, updater: Updater<T>, isOptimistic = false) => {
      const store = getStore();
      store.executeUpdate(item, context, updater, configRef.current.update, isOptimistic);
    },
    [context, getStore]
  );

  const remove = useCallback(
    (item: T) => {
      const store = getStore();
      store.executeRemove(item, context, configRef.current.remove);
    },
    [context, getStore]
  );

  const cancelFetch = useCallback(() => {
    const store = getStore();
    store.cancelFetch();
  }, [getStore]);

  const cancelOperation = useCallback(
    (id: string) => {
      const store = getStore();
      store.cancelOperation(id);
    },
    [getStore]
  );

  //   implement re-try last operation

  return {
    fetch,
    refetch,
    create,
    update,
    remove,
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
  const store = useMemo<Store<T>>(
    () =>
      Store.createStore({
        id: config.id,
        initialData: [],
        caching: config.caching,
        debounce: config.debounce,
      }),
    [config]
  );
  const { refetch, create, update, remove, cancelOperation, cancelFetch } =
    useCrudOperations(config);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, config.getServerSnapshot);

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id, config.context]);

  const items = useMemo(() => {
    return map([...state.items.values()], (item) => ({
      ...item,
      id: item.data.id,
    }));
  }, [state.items]);

  return useMemo(
    () => ({
      itemsById: state.items,
      items,
      metadata: state.fetchState.metadata,
      isLoading: state.fetchState.isLoading,
      hasError: size(state.fetchState.errors) > 0 || some(items, (item) => item.errors.length > 0),
      errors: state.fetchState.errors,
      create,
      update,
      remove,
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
      update,
      remove,
      cancelFetch,
      cancelOperation,
    ]
  );
}
