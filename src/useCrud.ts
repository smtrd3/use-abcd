/* eslint-disable @typescript-eslint/no-explicit-any */
// biome-ignore assist/source/organizeImports: self managed
import { compact, identity, join, map, set, size, some } from "lodash-es";
import { create, type Draft } from "mutative";
import { nanoid } from "nanoid";
import { useMemo, useCallback, useSyncExternalStore, useEffect } from "react";
import { FetchCache } from "./FetchCache";
import { CANCEL_RECOVERABLE, CANCELLED_BY_USER, useMemoDeepEquals, wait } from "./utils";

export type Item = { id: string } & Record<string, any>;

export type TransitionStates = "create" | "update" | "delete" | "idle" | "changed";

export type ItemWithState<
  T extends Item = Item,
  State extends TransitionStates = TransitionStates,
> = {
  data: T;
  optimistic: boolean;
  errors: Map<string, string[]>;
  // only update can have multiple transitions
  // stored as tag -> [state, item, time]
  transitions: Map<string | "default", [State, State extends "idle" ? undefined : T, ts: number]>;
};

export type QueryOption = {
  signal: AbortSignal;
  context: unknown;
};

export type FetchFn<T extends Item = Item, M extends object = object> = (
  option: QueryOption,
) => Promise<{ items: T[]; metadata?: M }>;

export type TransitionFn<T extends Item = Item> = (
  item: Partial<T>,
  option: QueryOption,
) => Promise<{ id: string }>;

export type Updater<T> = (updatable: T) => void;

export type StoreState<
  T extends Item = Item,
  C extends object = object,
  M extends object = object,
> = {
  context: C;
  items: Map<string, ItemWithState<T>>;
  fetchState: {
    isLoading: boolean;
    errors: string[];
    metadata?: M;
  };
};

export type CrudConfig<
  T extends Item = Item,
  C extends object = object,
  M extends object = object,
> = {
  id: string;
  context: C;
  debounce?: number;
  caching?: {
    capacity: number; // capacity is in pages
    age: number;
  };
  fetch?: FetchFn<T, M>;
  create?: TransitionFn<T>;
  update?: TransitionFn<T>;
  remove?: TransitionFn<T>;
  getServerSnapshot?: () => StoreState<T>;
};

const INITIAL_STORE_STATE: StoreState<Item, object, object> = Object.freeze({
  items: new Map(),
  context: {},
  fetchState: {
    isLoading: false,
    errors: [],
    metadata: {},
  },
});

/**
 * Core state management store for CRUD operations.
 * Handles data fetching, caching, and state transitions for items.
 * @template T - Type of items managed by the store, must extend Item base type
 */
class Store<T extends Item = Item, C extends object = object, M extends object = object> {
  batched = false;
  state: StoreState<T, C, M> = INITIAL_STORE_STATE as StoreState<T, C, M>;
  subscribers: Set<() => void> = new Set();
  controllers: Map<string, AbortController> = new Map();
  fetchController: AbortController = new AbortController();
  fetchCache: FetchCache = new FetchCache();

  constructor(
    private id: string = "<none>",
    private config: CrudConfig<T, C, M>,
  ) {
    this.setItems([]); // need to figure out how to set the initial items

    const { caching: { age = 0, capacity = 0 } = { age: 0, capacity: 0 }, context } = config;
    this.state.context = context;
    this.fetchCache.reset(age, capacity);
  }

  public executeFetch = async (newContext: C) => {
    const { fetch: fetchFn } = this.config;
    const cacheKey = this.getCacheKey();
    this.startFetch();

    try {
      let response: Awaited<ReturnType<FetchFn<T, M>>> | null = null;

      if (fetchFn) {
        response = (await this.fetchCache.withCache(cacheKey, async () => {
          await wait(this.config.debounce || 0, this.fetchController.signal, () => {
            this.customLog("delay", "Fetch operation canceled due to debounce re-entry");
          });

          this.customLog("fetch execution", "Executing fetch function");
          return fetchFn({
            signal: this.fetchController.signal,
            context: newContext,
          });
        })) as Awaited<ReturnType<FetchFn<T, M>>>;
      } else {
        response = { items: [] as T[], metadata: {} as M };
      }

      this.batch(() => {
        this.setItems(response.items);
        this.setMetadata(response.metadata as M);
        this.setContext(newContext);
        this.endFetch();
      });
    } catch (ex) {
      if ((ex as Error).name === "AbortError" || ex === CANCEL_RECOVERABLE) {
        this.customLog("fetch exception", "Fetch operation was cancelled by client");
        return;
      }

      if (ex === CANCELLED_BY_USER) {
        this.customLog("fetch exception", "Fetch operation was cancelled by user");
        this.endFetch();
        return;
      }

      this.batch(() => {
        this.endFetch([ex.message]);
        this.setItems([]);
      });
    }
  };

  public executeRemove = async (input: T) => {
    const { context } = this.state;
    const { remove: save } = this.config;
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
        if (
          (ex as Error).name === "AbortError" ||
          ex === CANCEL_RECOVERABLE ||
          ex === CANCELLED_BY_USER
        ) {
          // in all scenarios just ignore the remove operation
          return;
        }

        this.startTransition({
          id: input.id,
          input: input,
          state: "delete",
          errors: [(ex as Error).message],
        });
      }
    } else {
      this.batch(() => {
        this.remove(input.id);
        this.startTransition({ id: input.id, fromState: "delete", state: "idle" });
      });
    }

    this.fetchCache.remove(this.getCacheKey());
  };

  public executeUpdate = async ({
    item,
    updater = identity,
    isOptimistic = false,
    skipSave = false,
    tag = undefined, // for multiple parallel updates use tags
  }: {
    item: T;
    updater?: Updater<T>;
    isOptimistic?: boolean;
    skipSave?: boolean;
    tag?: string;
  }) => {
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
        tag,
      });

      if (isOptimistic) {
        this.updateItem(updatedItem);
      }

      if (save && !skipSave) {
        try {
          await save(updatedItem, { signal: controller.signal, context });
          this.updateItem(updatedItem);
          this.startTransition({ id: itemId, state: "idle", fromState: "update", tag });
        } catch (ex: unknown) {
          if ((ex as Error).name === "AbortError" || ex === CANCEL_RECOVERABLE) {
            // will be tried again
            return;
          }

          if (ex === CANCELLED_BY_USER) {
            this.batch(() => {
              this.updateItem(item); // revert to original item
              this.startTransition({ id: updatedItem.id, state: "idle", fromState: "update", tag });
            });

            return;
          }

          this.startTransition({
            id: itemId,
            input: updatedItem,
            state: "update",
            errors: [(ex as Error).message],
            tag,
          });
        }
      } else {
        this.updateItem(updatedItem);
        this.startTransition({ id: itemId, state: "changed", tag });
      }

      this.fetchCache.remove(this.getCacheKey());
    }
  };

  public executeCreate = async (input: Partial<T>) => {
    const { context } = this.state;
    const { create: save } = this.config;
    const randomId = `create_${nanoid(8)}`;
    const inputWithId = { ...input, id: randomId };

    const append = (id?: string) => {
      this.state = create(this.state, (draftState) => {
        const itemWithState: ItemWithState<T> = {
          data: { ...input, id: id || randomId } as T,
          errors: new Map(),
          optimistic: true, // always true for create
          transitions: new Map([["default", ["create", input as T, Date.now()]]]),
        };

        draftState.items.set(id || randomId, itemWithState as any);
      });

      this.notify();
    };

    // by design always append - since status is tracked per object level
    append();

    const controller = this.startTransition({
      id: randomId,
      input: inputWithId as T,
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

        if (!savedId) {
          throw new Error("create action must return id of the created item");
        }

        const newItems: Map<string, ItemWithState<T>> = new Map();

        // replace randomId with real id while maintaining order
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

        this.startTransition({ id: savedId, state: "idle", fromState: "create" });
      } catch (ex) {
        if ((ex as Error).name === "AbortError" || ex === CANCEL_RECOVERABLE) {
          // will be tried again
          return;
        }

        if (ex === CANCELLED_BY_USER) {
          this.remove(randomId);
          return;
        }

        this.startTransition({
          id: randomId,
          input: inputWithId as T,
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

  private getCacheKey() {
    const { context } = this.state;
    return `[${this.id}, ${JSON.stringify(context)}]`;
  }

  private getControlerId = (itemId: string, tag?: string) => {
    return join(compact([itemId, tag === "default" ? null : tag]), ":");
  };

  public customLog = (title: string = "log", ...messages: any[]) => {
    if (import.meta.env.DEV) {
      console.groupCollapsed(`[useCrud]#${this.id} ${title}`);
      console.log(...messages);
      console.groupEnd();
    }
  };

  private batch = (fn: () => void) => {
    this.batched = true;
    fn();
    this.batched = false;
    this.notify();
  };

  private setItems = (items: T[]) => {
    const ids = new Set(map(items, "id"));

    if (ids.size !== size(items)) {
      throw new Error("Missing `id` prop on one or more items");
    }

    const itemsMap: Map<string, ItemWithState<T>> = new Map();

    items.forEach((item) => {
      item.id = `${item.id}`;
      itemsMap.set(item.id, {
        data: item,
        optimistic: false,
        errors: new Map(),
        transitions: new Map(),
      });
    });

    this.state = create(this.state, (draftState) => {
      draftState.items = itemsMap as any;
    });

    this.notify();
  };

  private setMetadata = (metadata: M) => {
    this.state = create(this.state, (draftState) => {
      draftState.fetchState.metadata = metadata as Draft<M>;
    });
    this.notify();
  };

  private setContext = (context: C) => {
    this.state = create(this.state, (draft) => {
      draft.context = context as Draft<C>;
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

  public cancelFetch = () => {
    this.fetchController.abort();
  };

  public cancelOperation = (id: string, tag?: string) => {
    const controllerId = this.getControlerId(id, tag);
    this.controllers.get(controllerId)?.abort(CANCELLED_BY_USER);
  };

  private startTransition = ({
    id,
    input = undefined,
    state,
    fromState = state, // only required for parallel updates
    isOptimistic = false,
    errors = [],
    tag = "default",
  }: {
    id: string;
    input?: T;
    state: TransitionStates;
    fromState?: TransitionStates;
    isOptimistic?: boolean;
    errors?: string[];
    tag?: string;
  }) => {
    const controller = new AbortController();
    const controllerId = this.getControlerId(id, tag);

    if (this.state.items.has(id)) {
      this.controllers.get(controllerId)?.abort();
      this.controllers.set(controllerId, controller);
      this.state = create(this.state, (draft) => {
        const draftItem = draft.items.get(id) as ItemWithState<T>;
        draftItem.optimistic = isOptimistic;

        // errKey example -> update:like
        const errKey = join(compact([fromState, tag === "default" ? null : tag]), ":");

        if (state === "idle") {
          draftItem.errors.delete(errKey);
        } else {
          if (size(errors) > 0) {
            draftItem.errors.set(errKey, errors);
          }
        }

        if (state === "idle") {
          draftItem.transitions.delete(tag);
        } else {
          draftItem.transitions.set(tag, [state, input, Date.now()]);
        }
      });

      this.notify();
    }

    return controller;
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
  static createStore<T extends Item = Item, C extends object = object, M extends object = object>(
    config: CrudConfig<T, C, M>,
  ): Store<T, C> {
    const { id } = config;
    if (Store.instances.has(id)) {
      return Store.instances.get(id) as Store<T, C, M>;
    }

    Store.instances.set(id, new Store(id, config));
    return Store.instances.get(id) as Store<T, C, M>;
  }
}

/**
 * Main hook for managing CRUD operations with automatic state management.
 * Provides access to items, metadata, loading states, and CRUD operations.
 * @template T - Type of items to manage, must extend Item base type
 * @template C - Type of context object used in operations
 * @param config - Configuration object for CRUD operations
 * @returns Object containing items, state information, and CRUD operation handlers
 */
export function useCrud<
  T extends Item = Item,
  C extends object = object,
  M extends object = object,
>(config: CrudConfig<T, C, M>) {
  const store = Store.createStore<T, C, M>(config);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    config.getServerSnapshot || (() => INITIAL_STORE_STATE),
  ) as StoreState<T, C, M>;

  const memoContext = useMemoDeepEquals(config.context);

  const refetch = useCallback(() => {
    store.clearFetchCache();
    store.executeFetch(memoContext);
  }, [store, memoContext]);

  const cancelFetch = useCallback(() => {
    store.cancelFetch();
  }, [store]);

  const cancelOperation = useCallback(
    (id: string, tag?: string) => {
      store.cancelOperation(id, tag);
    },
    [store],
  );

  const create = useCallback(
    (item: Partial<T>) => {
      return store.executeCreate(item);
    },
    [store],
  );

  const remove = useCallback(
    (item: T) => {
      return store.executeRemove(item);
    },
    [store],
  );

  const setContext = useCallback(
    (context: C) => {
      store.executeFetch(context);
    },
    [store],
  );

  useEffect(() => {
    setContext(memoContext);
  }, [setContext, memoContext]);

  const items = useMemo(() => [...state.items.values()], [state.items]);

  const hasError = size(state.fetchState.errors) > 0 || some(items, (item) => item.errors.size > 0);

  const snapshot = useMemo(
    () => ({
      itemsById: state.items,
      items,
      fetchState: state.fetchState,
      hasError,
      cancelFetch,
      cancelOperation,
      refetch,
      create,
      remove,
      store,
    }),
    [
      store,
      state.items,
      state.fetchState,
      items,
      cancelFetch,
      cancelOperation,
      refetch,
      create,
      remove,
      hasError,
    ],
  );

  store.customLog("snapshot", snapshot);
  return snapshot;
}

export function useItemState<T extends Item = Item>(
  storeId: string,
  item: ItemWithState<T>,
): [
    T,
    {
      store: Store<T>;
      hasError: boolean;
      errorCount: number;
      itemWithState: ItemWithState<T>;
      states: Set<string>;
      errors: Map<string, string[]>;
      save: () => Promise<void>;
      change: (cb: Updater<T>, tag?: string) => Promise<void>;
      update: (cb: Updater<T>, options?: { tag?: string; isOptimistic?: boolean }) => Promise<void>;
      remove: () => Promise<void>;
      cancel: () => void;
    },
  ] {
  const store = Store.instances.get(storeId) as Store<T>;
  const data = useMemo(() => item.data, [item.data]);
  const transitions = useMemo(() => item.transitions, [item.transitions]);

  const update = useCallback(
    (
      updater: Updater<T>,
      { tag, isOptimistic = false }: { tag?: string; isOptimistic?: boolean } = {},
    ) => {
      return store.executeUpdate({ item: data, updater, tag, isOptimistic });
    },
    [data, store],
  );

  const remove = useCallback(() => {
    return store.executeRemove(data);
  }, [data, store]);

  const change = useCallback(
    (cb: Updater<T>, tag?: string) => {
      return store.executeUpdate({ item: data, updater: cb, isOptimistic: true, skipSave: true, tag });
    },
    [data, store],
  );

  const save = useCallback(() => {
    return store.executeUpdate({ item: data, updater: identity, isOptimistic: false });
  }, [data, store]);

  const cancel = useCallback(
    (tag?: string) => {
      store.cancelOperation(data.id, tag);
    },
    [store, data.id],
  );

  const states = useMemo(() => {
    const uniqueStates: Set<string> = new Set();

    transitions.forEach((value, tag) => {
      const [state] = value;
      uniqueStates.add(`${state}${tag === "default" ? "" : `:${tag}`}`);
    });

    return uniqueStates;
  }, [transitions]);

  const hasError = useMemo(() => item.errors.size > 0, [item.errors]);

  const errorCount = useMemo(() => item.errors.size, [item.errors]);

  const errors = useMemo(() => item.errors, [item.errors]);

  return [
    data,
    {
      update,
      change,
      save,
      remove,
      cancel,
      errors,
      errorCount,
      hasError,
      states,
      itemWithState: item,
      store,
    },
  ];
}
