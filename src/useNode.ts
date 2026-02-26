import { useSyncExternalStore, useCallback, useMemo } from "react";
import type { Draft } from "mutative";
import type { Node, TreeNode } from "./node";
import type { ItemStatus } from "./types";

/**
 * Result type for useNode hook - contains all node data and operations
 */
export type UseNodeResult<T extends object, C, NodeType = string> = {
  isPresent: boolean;
  data: TreeNode<T, NodeType> | undefined;
  status: ItemStatus;
  exists: boolean;
  isSelected: boolean;
  depth: number;
  getParent: () => Node<T, C, NodeType> | null;
  children: Node<T, C, NodeType>[];
  append: (value: T, type?: NodeType) => string;
  prepend: (value: T, type?: NodeType) => string;
  move: (targetPosition: number, targetParent?: Node<T, C, NodeType>) => void;
  moveUp: () => void;
  moveDown: () => void;
  setPosition: (targetIndex: number) => void;
  clone: () => Map<string, TreeNode<T, NodeType>>;
  updateProp: (mutate: (draft: Draft<T>) => void) => void;
  remove: () => void;
  select: () => void;
  deselect: () => void;
};

export function useNode<T extends object, C, NodeType = string>(
  node: Node<T, C, NodeType>,
): UseNodeResult<T, C, NodeType> {
  const subscribe = useCallback((cb: () => void) => node.collection.subscribe(cb), [node]);

  const data = useSyncExternalStore(
    subscribe,
    () => node.data,
    () => node.data,
  );

  const status = useSyncExternalStore(
    subscribe,
    () => node.getStatus(),
    () => node.getStatus(),
  );

  const exists = useSyncExternalStore(
    subscribe,
    () => node.exists(),
    () => node.exists(),
  );

  const isSelected = useSyncExternalStore(
    subscribe,
    () => node.collection.selectedNodeId === node.id,
    () => node.collection.selectedNodeId === node.id,
  );

  // Recompute children only when the node's data reference changes.
  // Mutations that affect children (append, remove, reorder) bump
  // clientUpdatedAt on the parent, producing a new data reference.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const children = useMemo(() => node.getChildren(), [data, node]);

  const getParent = useCallback(() => node.getParent(), [node]);
  const append = useCallback((value: T, type?: NodeType) => node.append(value, type), [node]);
  const prepend = useCallback((value: T, type?: NodeType) => node.prepend(value, type), [node]);
  const move = useCallback(
    (pos: number, targetParent?: Node<T, C, NodeType>) => node.move(pos, targetParent),
    [node],
  );
  const moveUp = useCallback(() => node.moveUp(), [node]);
  const moveDown = useCallback(() => node.moveDown(), [node]);
  const setPosition = useCallback((targetIndex: number) => node.setPosition(targetIndex), [node]);
  const clone = useCallback(() => node.clone(), [node]);
  const updateProp = useCallback(
    (mutate: (draft: Draft<T>) => void) => node.updateProp(mutate),
    [node],
  );
  const remove = useCallback(() => node.remove(), [node]);
  const select = useCallback(() => node.select(), [node]);
  const deselect = useCallback(() => node.collection.deselectNode(), [node]);

  return {
    isPresent: true,
    data,
    status,
    exists,
    isSelected,
    depth: node.depth,
    getParent,
    children,
    append,
    prepend,
    move,
    moveUp,
    moveDown,
    setPosition,
    clone,
    updateProp,
    remove,
    select,
    deselect,
  };
}
