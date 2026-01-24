import { useSyncExternalStore, useCallback, useRef } from "react";
import { isEqual, size } from "lodash-es";
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
  clone: () => Map<string, TreeNode<T, NodeType>>;
  updateProp: (mutate: (draft: Draft<T>) => void) => void;
  remove: () => void;
  select: () => void;
  deselect: () => void;
};

// Helper to compare children arrays by their IDs
function childrenChanged<T extends object, C, NodeType>(
  prev: Node<T, C, NodeType>[],
  next: Node<T, C, NodeType>[],
): boolean {
  if (!isEqual(size(prev), size(next))) return true;
  for (let i = 0; i < size(prev); i++) {
    if (!isEqual(prev[i].id, next[i].id)) return true;
  }
  return false;
}

type NodeSnapshot<T extends object, C, NodeType> = {
  data: TreeNode<T, NodeType> | undefined;
  status: ItemStatus;
  exists: boolean;
  isSelected: boolean;
  children: Node<T, C, NodeType>[];
};

const DEFAULT_NODE_VALUE = {
  data: undefined,
  status: null,
  exists: false,
  isSelected: false,
  children: [],
};

export function useNode<T extends object, C, NodeType = string>(
  node: Node<T, C, NodeType>,
): UseNodeResult<T, C, NodeType> {
  // Cache for reference stability
  const snapshotRef = useRef<NodeSnapshot<T, C, NodeType>>(DEFAULT_NODE_VALUE);

  const snapshot = useSyncExternalStore(
    (cb) => node.collection.subscribe(cb),
    () => {
      const nextChildren = node.getChildren();
      const prev = snapshotRef.current;

      const children = !childrenChanged(prev.children, nextChildren) ? prev.children : nextChildren;
      const nextSnapshot: NodeSnapshot<T, C, NodeType> = {
        data: node.data,
        status: node.getStatus(),
        exists: node.exists(),
        isSelected: isEqual(node.collection.selectedNodeId, node.id),
        children,
      };

      if (!isEqual(prev, nextSnapshot)) {
        snapshotRef.current = nextSnapshot;
      }

      return snapshotRef.current;
    },
    () => snapshotRef.current,
  );

  const getParent = useCallback(() => node.getParent(), [node]);
  const append = useCallback((value: T, type?: NodeType) => node.append(value, type), [node]);
  const prepend = useCallback((value: T, type?: NodeType) => node.prepend(value, type), [node]);
  const move = useCallback(
    (pos: number, targetParent?: Node<T, C, NodeType>) => node.move(pos, targetParent),
    [node],
  );
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
    data: snapshot.data,
    status: snapshot.status,
    exists: snapshot.exists,
    isSelected: snapshot.isSelected,
    depth: node.depth,
    getParent,
    children: snapshot.children,
    append,
    prepend,
    move,
    clone,
    updateProp,
    remove,
    select,
    deselect,
  };
}
