import { useSyncExternalStore, useCallback, useMemo } from "react";
import { sortBy, map, filter } from "lodash-es";
import { Collection, buildServerSnapshot } from "./collection";
import type { Node, TreeNode } from "./node";
import type { Config, Mutator } from "./types";

/**
 * Config for useCrudTree - same as Config but with rootId required
 */
export type TreeConfig<T extends object, C, NodeType = string> = Omit<
  Config<TreeNode<T, NodeType>, C>,
  "rootId"
> & {
  rootId: string; // Required for tree collections
};

/**
 * Hook for tree-based CRUD operations.
 * This is a replacement for useCrud when working with tree structures.
 * It requires rootId in the config and returns the root node along with
 * all the standard useCrud properties.
 *
 * @param config - Tree collection configuration with required rootId
 * @returns Object with crud operations, state, and the root node
 */
export function useCrudTree<T extends object, C, NodeType = string>(
  config: TreeConfig<T, C, NodeType>,
) {
  const fullConfig = config as Config<TreeNode<T, NodeType>, C>;
  const collection = Collection.get(fullConfig);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const serverSnapshot = useMemo(() => buildServerSnapshot(fullConfig), [config.id]);

  const state = useSyncExternalStore(
    (callback) => collection.subscribe(callback),
    () => collection.getState(),
    () => serverSnapshot,
  );

  const rootNode = useSyncExternalStore(
    (cb) => collection.subscribe(cb),
    () => {
      const rootData = collection.items.get(config.rootId);
      return rootData
        ? (collection.getNode<T, NodeType>(config.rootId) as Node<T, C, NodeType>)
        : null;
    },
    () => null,
  );

  const selectedNodeId = useSyncExternalStore(
    (cb) => collection.subscribe(cb),
    () => collection.selectedNodeId,
    () => null,
  );

  const selectedNode = useSyncExternalStore(
    (cb) => collection.subscribe(cb),
    () => collection.selectedNode as Node<T, C, NodeType> | null,
    () => null,
  );

  const toJson = useCallback(() => {
    const separator = config.nodeSeparator ?? ".";

    // Helper to check if nodeId is a direct child of parentId
    const isDirectChild = (nodeId: string, parentId: string): boolean => {
      if (!nodeId.startsWith(parentId + separator)) return false;
      return !nodeId.slice(parentId.length + 1).includes(separator);
    };

    // Recursively build JSON tree structure
    const buildJsonTree = (nodeId: string): object | null => {
      const nodeData = state.items.get(nodeId) as TreeNode<T, NodeType> | undefined;
      if (!nodeData) return null;

      const childEntries = map(
        filter([...state.items.entries()], ([id]) => isDirectChild(id, nodeId)),
        ([id, data]) => ({ id, position: (data as TreeNode<T, NodeType>).position }),
      );
      const sortedChildren = sortBy(childEntries, "position");
      const children = map(sortedChildren, (entry) => buildJsonTree(entry.id)).filter(Boolean);

      return {
        id: nodeData.id,
        type: nodeData.type,
        value: nodeData.value,
        ...(children.length > 0 ? { children } : {}),
      };
    };

    return buildJsonTree(config.rootId);
  }, [state.items, config.rootId, config.nodeSeparator]);

  return {
    // Root node for tree operations
    rootNode,

    // State (all from single immutable state object)
    items: state.items,
    context: state.context,
    syncState: state.syncState,
    syncQueue: state.syncQueue,
    loading: state.loading,
    syncing: state.syncing,
    fetchStatus: state.fetchStatus,
    fetchError: state.fetchError,

    // Node operations
    getNode: (id: string) => collection.getNode<T, NodeType>(id) as Node<T, C, NodeType>,
    getNodeStatus: (id: string) => collection.getItemStatus(id),

    // Context & refresh
    setContext: (patchContext: Mutator<C>) => collection.setContext(patchContext),
    refresh: () => collection.refresh(),

    // Sync controls
    pauseSync: () => collection.pauseSync(),
    resumeSync: () => collection.resumeSync(),
    retrySync: (id?: string) => collection.retrySync(id),

    // Selection
    selectNode: (id: string) => collection.selectNode(id),
    deselectNode: () => collection.deselectNode(),
    selectedNodeId,
    selectedNode,

    // Serialization
    toJson,
  };
}
