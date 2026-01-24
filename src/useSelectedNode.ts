import { useSyncExternalStore, useMemo } from "react";
import { Collection } from "./collection";
import type { Node, TreeNode } from "./node";
import { useNode, type UseNodeResult } from "./useNode";

// Stable empty result for when no node is selected
const EMPTY_RESULT = {
  isPresent: false,
  data: undefined,
  status: null,
  exists: false,
  isSelected: false,
  depth: 0,
  getParent: () => null,
  children: [],
  append: () => "",
  prepend: () => "",
  move: () => {},
  clone: () => new Map(),
  updateProp: () => {},
  remove: () => {},
  select: () => {},
  deselect: () => {},
};

/**
 * Hook for accessing and operating on the currently selected node in a collection.
 *
 * This is a wrapper around useNode that automatically tracks the selected node.
 * Use this in components that need to operate on whatever node is currently selected
 * (e.g., toolbars, property panels, context menus).
 *
 * @param collectionId - The ID of the collection to get the selected node from
 * @returns UseNodeResult with isPresent=true when a node is selected, or isPresent=false with empty data
 */
export function useSelectedNode<T extends object, C, NodeType = string>(
  collectionId: string,
): UseNodeResult<T, C, NodeType> {
  const collection = Collection.getById<TreeNode<T, NodeType>, C>(collectionId);
  if (!collection) {
    throw new Error(
      `Collection with id "${collectionId}" not found. Make sure useCrud is called first.`,
    );
  }

  const selectedNode = useSyncExternalStore(
    (cb) => collection.subscribe(cb),
    () => collection.selectedNode as Node<T, C, NodeType> | null,
    () => collection.selectedNode as Node<T, C, NodeType> | null,
  );

  // Always call useNode to maintain hooks order - use dummy node when nothing selected
  const dummyNode = useMemo(() => collection.getNode<T, NodeType>("__dummy__"), [collection]);
  const nodeResult = useNode(selectedNode ?? dummyNode);

  // Return empty result when no node is selected, otherwise return the useNode result
  return selectedNode ? nodeResult : (EMPTY_RESULT as unknown as UseNodeResult<T, C, NodeType>);
}
