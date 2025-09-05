/* eslint-disable @typescript-eslint/no-explicit-any */
import { set } from "lodash-es";
import { create } from "mutative";
import { nanoid } from "nanoid";

export type Item = { id: string } & Record<string, unknown>;

export type ItemWithState<T extends Item = Item> = {
  data: T;
  state: "create" | "update" | "delete" | "ready" | "error";
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

export type StoreState<T extends Item = Item> = {
  fetchState: { isLoading: boolean; errors: string[] };
  items: Map<string, ItemWithState<T>>;
};

export type CreateStoreConfig<T extends Item = Item> = {
  id: string;
  initialData?: T[];
  caching?: {
    size: number;
    time: number;
  };
};

type CachedItem = { data: unknown; ts: number };

class FetchCache {
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
    if (this.storage.size === this.capacity && this.capacity > 0) {
      const delKey = [...this.storage.keys()].at(-1);
      this.storage.delete(delKey);
    }
    if (this.capacity > 0) {
      this.storage.set(id, { data: item, ts: Date.now() });
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

export class Store<T extends Item = Item> {
  id: string = "<none>";
  state: StoreState<T> = {
    items: new Map(),
    fetchState: {
      isLoading: false,
      errors: [],
    },
  };
  subscribers: Set<() => void> = new Set();
  controllers: Map<string, AbortController> = new Map();
  fetchController: AbortController = new AbortController();
  fetchCache: FetchCache = new FetchCache();

  constructor(
    id: string,
    initialData: T[],
    cacheOptions?: { time: number; size: number }
  ) {
    this.id = id;
    this.setItems(initialData);
    this.fetchCache.reset(cacheOptions?.time || 0, cacheOptions?.size || 0);
  }

  getCacheKey(context: unknown) {
    return `[${this.id}, ${JSON.stringify(context)}]`;
  }

  setItems = (items: T[]) => {
    const map: Map<string, ItemWithState<T>> = new Map();
    items.forEach((item) => {
      map.set(item.id, {
        data: item,
        state: "ready",
        optimistic: false,
        errors: [],
      });
    });

    this.state = create(this.state, (draftState) => {
      draftState.items = map as any;
    });

    this.notify();
  };

  executeRemove = async (
    input: T,
    context: unknown,
    save?: TransitionFn<T>
  ) => {
    const controller = this.startTransition(
      input.id,
      input,
      "delete",
      false,
      []
    );
    const remove = () => {
      this.state = create(this.state, (draftState) => {
        draftState.items.delete(input.id);
      });

      this.notify();
    };

    if (save) {
      try {
        await save(input, { signal: controller.signal, context });
        remove();
        this.startTransition(input.id, undefined, "ready", false, []);
      } catch (ex) {
        this.startTransition(input.id, input, "delete", false, [
          (ex as Error).message,
        ]);
      }
    } else {
      remove();
      this.startTransition(input.id, undefined, "ready", false, []);
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
      const controller = this.startTransition(
        itemId,
        updatedItem,
        "update",
        isOptimistic
      );

      const updateItem = () => {
        this.state = create(this.state, (draftState) => {
          const selectedItem = draftState.items.get(itemId);
          if (selectedItem) {
            set(selectedItem, "data", updatedItem);
          }
        });

        this.notify();
      };

      if (isOptimistic) {
        updateItem();
      }

      if (save) {
        try {
          await save(updatedItem, { signal: controller.signal, context });
          updateItem();
          this.startTransition(itemId, undefined, "ready", false);
        } catch (ex: unknown) {
          this.startTransition(itemId, updatedItem, "error", false, [
            (ex as Error).message,
          ]);
        }
      } else {
        updateItem();
        this.startTransition(itemId, undefined, "ready", false);
      }

      this.fetchCache.remove(this.getCacheKey(context));
    }
  };

  executeCreate = async (
    context: unknown,
    input: T,
    save?: TransitionFn<T>,
    isOptimistic = false
  ) => {
    const randomId = `create_${nanoid(8)}`;
    const inputWithId = { ...input, id: randomId };
    const controller = this.startTransition(
      randomId,
      inputWithId,
      "create",
      isOptimistic,
      []
    );

    const append = (id?: string) => {
      this.state = create(this.state, (draftState) => {
        const itemWithState: ItemWithState<T> = {
          data: { ...input, id: id || randomId },
          errors: [],
          optimistic: isOptimistic,
          state: "create",
          input: inputWithId,
        };

        draftState.items.set(id || randomId, itemWithState as any);
      });
      this.notify();
    };

    if (isOptimistic) {
      append();
    }

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

          this.startTransition(savedId, undefined, "ready", false, []);
        } else {
          append(savedId);
          this.startTransition(savedId, undefined, "ready", false, []);
        }
      } catch (ex) {
        this.startTransition(randomId, inputWithId, "create", false, [
          (ex as Error).message,
        ]);
      }
    } else {
      append();
      this.startTransition(randomId, undefined, "ready", false);
    }

    this.fetchCache.remove(this.getCacheKey(context));
  };

  startTransition = (
    id: string,
    input: T | undefined,
    state: ItemWithState<T>["state"],
    isOptimistic = false,
    errors: string[] = []
  ) => {
    const controller = new AbortController();
    if (this.state.items.has(id)) {
      this.controllers.get(id)?.abort();
      this.controllers.set(id, controller);
      this.state = create(this.state, (draft) => {
        const draftItem = draft.items.get(id) as ItemWithState<T>;
        draftItem.state = state;
        draftItem.optimistic = isOptimistic;
        draftItem.errors = errors;
        draftItem.input = input;
      });
      this.notify();
    }

    return controller;
  };

  private startFetch = () => {
    this.fetchController.abort();
    this.state = create(this.state, (state) => {
      state.fetchState.isLoading = true;
    });
    this.fetchController = new AbortController();
    this.notify();
  };

  executeFetch = async <Context extends Record<string, unknown>>(
    context: Context,
    fetchFn: FetchFn<T>
  ) => {
    this.startFetch();
    try {
      const response = fetchFn
        ? this.fetchCache.withCache(this.getCacheKey(context), () => {
            return fetchFn({
              signal: this.fetchController.signal,
              context,
            });
          }) as ReturnType<FetchFn<T>>
        : { items: [], metadata: {} };

      this.fetchCache.put(this.getCacheKey(context), response);

      this.setItems(response.items);
      this.endFetch();
    } catch (ex) {
      this.endFetch([ex.message]);
    }
  };

  private endFetch = (errors: string[] = []) => {
    this.state = create(this.state, (state) => {
      state.fetchState.isLoading = false;
      state.fetchState.errors = errors;
    });
    this.notify();
  };

  notify = () => {
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
  static createStore<T extends Item = Item>(
    config: CreateStoreConfig<T>
  ): Store<T> {
    const { id, caching, initialData = [] } = config;
    if (Store.instances.has(id)) {
      return Store.instances.get(id);
    }

    Store.instances.set(id, new Store(id, initialData, caching));
    return Store.instances.get(id);
  }
}
