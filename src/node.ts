import {
  sortBy,
  map,
  uniqueId,
  isEqual,
  join,
  get,
  head,
  find,
  filter,
  maxBy,
  minBy,
  forEach,
} from "lodash-es";
import type { Draft } from "mutative";
import type { Collection } from "./collection";
import type { ItemStatus } from "./types";

const DEFAULT_SEPARATOR = ".";

function getParentId(nodeId: string, separator: string): string | null {
  const idx = nodeId.lastIndexOf(separator);
  return idx === -1 ? null : nodeId.slice(0, idx);
}

function isDirectChild(nodeId: string, parentId: string, separator: string): boolean {
  if (!nodeId.startsWith(parentId + separator)) return false;
  return !nodeId.slice(parentId.length + 1).includes(separator);
}

function isDescendant(nodeId: string, ancestorId: string, separator: string): boolean {
  return nodeId.startsWith(ancestorId + separator);
}

function getDepth(nodeId: string, separator: string): number {
  // Zero-based: "root" = 0, "root.child" = 1, "root.child.grandchild" = 2
  return nodeId.split(separator).length - 1;
}

export type TreeNode<T, NodeType = string> = {
  id: string;
  position: number;
  value: T;
  type: NodeType;
};

export class Node<T extends object, C = unknown, NodeType = string> {
  private _id: string;
  private _collection: Collection<TreeNode<T, NodeType>, C>;
  private _cachedStatus: ItemStatus = null;

  constructor(collection: Collection<TreeNode<T, NodeType>, C>, id: string) {
    this._collection = collection;
    this._id = id;
  }

  private get _separator(): string {
    return this._collection.config.nodeSeparator ?? DEFAULT_SEPARATOR;
  }

  get id(): string {
    return this._id;
  }

  get data(): TreeNode<T, NodeType> | undefined {
    return this._collection.getState().items.get(this._id);
  }

  get collection(): Collection<TreeNode<T, NodeType>, C> {
    return this._collection;
  }

  get depth(): number {
    return getDepth(this._id, this._separator);
  }

  exists(): boolean {
    return this._collection.getState().items.has(this._id);
  }

  getStatus(): ItemStatus {
    const newStatus = this._collection.getItemStatus(this._id);
    if (!isEqual(this._cachedStatus, newStatus)) {
      this._cachedStatus = newStatus;
    }
    return this._cachedStatus;
  }

  getParent(): Node<T, C, NodeType> | null {
    const parentId = getParentId(this._id, this._separator);
    return parentId ? this._collection.getNode<T, NodeType>(parentId) : null;
  }

  getChildren(): Node<T, C, NodeType>[] {
    const items = [...this._collection.items.entries()];
    const childEntries = map(
      filter(items, ([id]) => isDirectChild(id, this._id, this._separator)),
      ([id, data]) => ({ id, position: (data as TreeNode<T, NodeType>).position }),
    );

    const sorted = sortBy(childEntries, "position");
    return map(sorted, (entry) => this._collection.getNode<T, NodeType>(entry.id));
  }

  private _generateChildId(): string {
    const { getNodeId } = this._collection.config;
    const nodeId = getNodeId ? getNodeId() : uniqueId();
    return join([this._id, nodeId], this._separator);
  }

  append(value: T, type: NodeType = "object" as NodeType): string {
    const children = this.getChildren();
    const maxChild = maxBy(children, (c) => get(c, "data.position", 0));
    const maxPosition = maxChild ? get(maxChild, "data.position", 0) : -1;
    const position = maxPosition + 1;
    const newId = this._generateChildId();

    const newNode: TreeNode<T, NodeType> = { id: newId, position, value, type };
    this._collection.create(newNode);
    return newId;
  }

  prepend(value: T, type: NodeType = "object" as NodeType): string {
    const children = this.getChildren();
    const minChild = minBy(children, (c) => get(c, "data.position", 0));
    const minPosition = minChild ? get(minChild, "data.position", 0) : 1;
    const position = minPosition - 1;
    const newId = this._generateChildId();

    const newNode: TreeNode<T, NodeType> = { id: newId, position, value, type };
    this._collection.create(newNode);
    return newId;
  }

  /**
   * Move node to a new position within the same parent (reordering)
   * or to a different parent (reparenting).
   *
   * @param targetPosition - The target position among siblings
   * @param targetParent - Optional target parent node. If not provided, moves within current parent.
   */
  move(targetPosition: number, targetParent?: Node<T, C, NodeType>): void {
    const nodeData = this.data;
    if (!nodeData) return;

    const currentParentId = getParentId(this._id, this._separator);
    if (!currentParentId) return; // Can't move root

    // If no target parent, move within current parent (reordering)
    if (!targetParent) {
      const currentPosition = nodeData.position;
      if (currentPosition === targetPosition) return;

      const parentNode = this._collection.getNode<T, NodeType>(currentParentId);
      const siblings = parentNode.getChildren();
      const targetSibling = find(siblings, (s) => get(s, "data.position") === targetPosition);

      this._collection.batch(() => {
        if (targetSibling) {
          this._collection.update(targetSibling.id, (draft) => {
            draft.position = currentPosition;
          });
        }
        this._collection.update(this._id, (draft) => {
          draft.position = targetPosition;
        });
      });
      return;
    }

    // Reparenting: clone to new parent and remove original
    if (targetParent.id === currentParentId) {
      // Same parent - just reorder
      this.move(targetPosition);
      return;
    }

    // Prevent moving a node into itself or its descendants
    if (targetParent.id === this._id || isDescendant(targetParent.id, this._id, this._separator)) {
      return;
    }

    // Clone this subtree with new IDs under target parent
    const clonedSubset = this.clone();

    this._collection.batch(() => {
      // Add cloned nodes under target parent
      targetParent._mergeClonedSubset(clonedSubset, targetPosition);

      // Remove original nodes
      this.remove();
    });
  }

  /**
   * Clone this node and all its descendants into a Map with remapped IDs.
   * The root of the clone has a temporary ID that will be remapped when merged.
   * @returns Map of cloned nodes keyed by their relative path from clone root
   */
  clone(): Map<string, TreeNode<T, NodeType>> {
    const nodeData = this.data;
    if (!nodeData) return new Map();

    const { getNodeId } = this._collection.config;
    const cloneRootId = getNodeId ? getNodeId() : uniqueId();
    const result = new Map<string, TreeNode<T, NodeType>>();

    // Clone self
    result.set(cloneRootId, {
      id: cloneRootId,
      position: nodeData.position,
      value: nodeData.value,
      type: nodeData.type,
    });

    // Clone all descendants with remapped IDs
    const descendants = filter([...this._collection.items.entries()], ([id]) =>
      isDescendant(id, this._id, this._separator),
    );

    forEach(descendants, ([id, data]) => {
      // Calculate relative path from this node
      const relativePath = id.slice(this._id.length + 1);
      const newId = join([cloneRootId, relativePath], this._separator);

      const treeData = data as TreeNode<T, NodeType>;
      result.set(newId, {
        id: newId,
        position: treeData.position,
        value: treeData.value,
        type: treeData.type,
      });
    });

    return result;
  }

  /**
   * Internal method to merge a cloned subset under this node.
   * The cloned nodes will have their IDs prefixed with this node's ID.
   */
  _mergeClonedSubset(
    clonedSubset: Map<string, TreeNode<T, NodeType>>,
    position?: number,
  ): string | undefined {
    if (clonedSubset.size === 0) return undefined;

    const keys = [...clonedSubset.keys()];

    // Find the root of the clone (should be a single top-level entry)
    // The root is the one with no separator in its key (just the generated ID)
    let cloneRootKey = find(keys, (key) => !key.includes(this._separator));

    if (!cloneRootKey) {
      // Fallback: find the shortest key
      cloneRootKey = head(sortBy(keys, (k) => k.length));
    }

    if (!cloneRootKey) return undefined;

    // Generate new ID for the merged root
    const newRootId = this._generateChildId();

    // Calculate position
    let targetPosition: number;
    if (position !== undefined) {
      targetPosition = position;
    } else {
      const children = this.getChildren();
      const maxChild = maxBy(children, (c) => get(c, "data.position", 0));
      const maxPosition = maxChild ? get(maxChild, "data.position", 0) : -1;
      targetPosition = maxPosition + 1;
    }

    // Add all cloned nodes with new IDs
    forEach([...clonedSubset.entries()], ([cloneId, cloneData]) => {
      let newId: string;
      if (cloneId === cloneRootKey) {
        newId = newRootId;
      } else {
        // Replace the clone root prefix with the new root ID
        const suffix = cloneId.slice(cloneRootKey.length);
        newId = join([newRootId, suffix.slice(this._separator.length)], this._separator);
      }

      const newNode: TreeNode<T, NodeType> = {
        id: newId,
        position: cloneId === cloneRootKey ? targetPosition : cloneData.position,
        value: cloneData.value,
        type: cloneData.type,
      };
      this._collection.create(newNode);
    });

    return newRootId;
  }

  updateProp(mutate: (draft: Draft<T>) => void): void {
    this._collection.update(this._id, (draft) => {
      mutate(draft.value);
    });
  }

  remove(): void {
    const items = [...this._collection.items.keys()];
    const descendantIds = map(
      filter(items, (id) => isDescendant(id, this._id, this._separator)),
      (id) => id,
    );
    const toRemove = [this._id, ...descendantIds];

    this._collection.batch(() => {
      const sorted = sortBy(toRemove, (id) => -getDepth(id, this._separator));
      forEach(sorted, (id) => this._collection.remove(id));
    });
  }

  select(): void {
    this._collection.selectNode(this._id);
  }

  _updateId(newId: string): void {
    this._id = newId;
  }
}
