/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Store, type FetchFn, type Item, type TransitionFn, type Updater } from "./Store";
import { isEqual, map, size } from "lodash-es";

export type CrudConfig<T extends Item = Item, C = any> = {
    id: string;
    context: C;
    caching?: {
        size: number; // size is in pages
        time: number;
    };
    fetch?: FetchFn<T>;
    create?: TransitionFn<T>
    update?: TransitionFn<T>;
    remove?: TransitionFn<T>;
};

export function useCrud<T extends Item = Item, C extends Record<string, any> = any>(config: CrudConfig<T, C>) {
    const configRef = useRef(config);
    const store = useMemo<Store<T>>(() => Store.createStore({ id: config.id, initialData: [], caching: config.caching }), [config.id]);
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

    const context = useMemo(() => {
        if (isEqual(config.context, configRef.current.context)) {
            return configRef.current.context;
        }
        configRef.current = config;
        return configRef.current.context;
    }, [config]);

    useEffect(() => {
        store.executeFetch(context, configRef.current.fetch);
    }, [context, store]);

    const create = useCallback((item: Omit<T, 'id'>, isOptimistic = false) => {
        store.executeCreate(context, item as T, configRef.current.create, isOptimistic);
    }, [context, store]);

    const update = useCallback((item: T, updater: Updater<T>, isOptimistic = false) => {
        store.executeUpdate(item, context, updater, configRef.current.update, isOptimistic);
    }, [context, store]);

    const remove = useCallback((item: T) => {
        store.executeRemove(item, context, configRef.current.remove);
    }, [context, store]);


    return useMemo(() => ({
        items: map([...state.items.values()], item => ({
            ...item,
            id: item.data.id,
        })),
        itemsById: state.items,
        isLoading: state.fetchState.isLoading,
        hasError: size(state.fetchState.errors) > 0,
        errors: state.fetchState.errors,
        create,
        update,
        remove,
    }), [state, update, create, remove]);
}