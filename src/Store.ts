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

export type FetchFn<T extends Item = Item> = (option: QueryOption) => Promise<{ items: T[]; metadata: unknown }>;

export type TransitionFn<T extends Item = Item> = (item: Partial<T>, option: QueryOption) => Promise<{ id: string }>;

export type Updater<T> = (updatable: T) => void;

export type StoreState<T extends Item = Item> = {
    fetchState: { isLoading: boolean; errors: string[] };
    items: Map<string, ItemWithState<T>>;
};

export type CreateStoreConfig<T extends Item = Item> = {
    id: string;
    initialData?: T[],
    caching?: {
        size: number;
        time: number;
    },
};

const globalCache: Map<string, { data: unknown; ts: number }> = new Map();

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
    cacheOptions = {
        time: 5000,
        size: 10,
    };
    cache = globalCache;

    constructor(id: string, initialData: T[], cacheOptions?: { time: number, size: number }) {
        this.id = id;
        this.setItems(initialData);
        if (cacheOptions) {
            this.cacheOptions = cacheOptions;
        } else {
            this.cacheOptions = {
                time: 0,
                size: 0,
            }
        }
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
    }

    executeRemove = async (input: T, context: unknown, save?: TransitionFn<T>) => {
        const controller = this.startTransition(input.id, input, "delete", false, []);
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
                this.startTransition(input.id, input, "delete", false, [(ex as Error).message]);
            }
        } else {
            remove();
            this.startTransition(input.id, undefined, "ready", false, []);
        }

        // invalidate cache
        const cacheKey = `${this.id}_${JSON.stringify(context)}`;
        this.cache.delete(cacheKey);
    }

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
            const controller = this.startTransition(itemId, updatedItem, "update", isOptimistic);

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
                    this.startTransition(itemId, updatedItem, "error", false, [(ex as Error).message]);
                }
            } else {
                updateItem();
                this.startTransition(itemId, undefined, "ready", false);
            }

            // invalidate cache
            const cacheKey = `${this.id}_${JSON.stringify(context)}`;
            this.cache.delete(cacheKey);
        }
    }

    executeCreate = async (context: unknown, input: T, save?: TransitionFn<T>, isOptimistic = false) => {
        const randomId = `create_${nanoid(8)}`;
        const inputWithId = { ...input, id: randomId };
        const controller = this.startTransition(randomId, inputWithId, "create", isOptimistic, []);

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
                const { id: savedId } = await save(input, { signal: controller.signal, context });
                // handle optimistic case
                if (this.state.items.has(randomId)) {
                    const newItems: Map<string, ItemWithState<T>> = new Map();
                    this.state.items.forEach((value, key) => {
                        if (key === randomId) {
                            newItems.delete(randomId);
                            newItems.set(savedId, { ...value, data: { ...value.data, id: savedId } });
                        } else {
                            newItems.set(key, value);
                        }
                    });

                    this.state = create(this.state, (draftState) => {
                        draftState.items = newItems as any;
                    });

                    this.startTransition(savedId, undefined, 'ready', false, []);
                } else {
                    append(savedId);
                    this.startTransition(savedId, undefined, "ready", false, []);
                }
            } catch (ex) {
                this.startTransition(randomId, inputWithId, "create", false, [(ex as Error).message]);
            }
        } else {
            append();
            this.startTransition(randomId, undefined, "ready", false);
        }

        // invalidate cache
        const cacheKey = `${this.id}_${JSON.stringify(context)}`;
        this.cache.delete(cacheKey);
    }

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
    }

    private startFetch = () => {
        this.fetchController.abort();
        this.state = create(this.state, (state) => {
            state.fetchState.isLoading = true;
        });
        this.fetchController = new AbortController();
        this.notify();
    }

    executeFetch = async <Context extends Record<string, unknown>>(context: Context, fetchFn: FetchFn<T>) => {
        const cacheKey = `${this.id}_${JSON.stringify(context)}`;
        if (this.cache.size > this.cacheOptions.size) {
            const toDelete = [...this.cache.keys()].at(-1);
            if (toDelete) {
                this.cache.delete(toDelete);
            }
        }

        const { data: cachedResponse, ts = Infinity } = this.cache.get(cacheKey) || {};
        const delta = Date.now() - ts;
        if (cachedResponse && delta < this.cacheOptions.time) {
            return cachedResponse;
        }

        this.startFetch();

        const response = fetchFn ? await fetchFn({
            signal: this.fetchController.signal,
            context,
        }) : { items: [], metadata: {} };

        if (this.cacheOptions.size > 0) {
            this.cache.set(cacheKey, { data: response, ts: Date.now() });
        }

        this.setItems(response.items);
        this.endFetch();
    }

    private endFetch = (errors: string[] = []) => {
        this.state = create(this.state, (state) => {
            state.fetchState.isLoading = false;
            state.fetchState.errors = errors;
        });
        this.notify();
    }

    notify = () => {
        this.subscribers.forEach((fn) => {
            fn();
        });
    }

    getSnapshot = () => {
        return this.state;
    }

    subscribe = (fn: () => void) => {
        this.subscribers.add(fn);
        return () => {
            this.subscribers.delete(fn);
        };
    }

    static instances: Map<string, Store<any>> = new Map();
    static createStore<T extends Item = Item>(config: CreateStoreConfig<T>): Store<T> {
        const { id, caching, initialData = [] } = config;
        if (Store.instances.has(id)) {
            return Store.instances.get(id);
        }

        Store.instances.set(id, new Store(id, initialData, caching));
        return Store.instances.get(id);
    }
}
