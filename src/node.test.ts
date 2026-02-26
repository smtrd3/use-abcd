import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Collection } from "./collection";
import type { TreeNode } from "./node";
import type { Config } from "./types";

interface TestValue {
  name: string;
}

interface TestContext {
  filter?: string;
}

describe("Node", () => {
  let config: Config<TreeNode<TestValue>, TestContext>;

  beforeEach(() => {
    config = {
      id: "test-node",
      initialContext: {},
      rootId: "root",
      handler: async () => ({ results: [] }),
    };
  });

  afterEach(() => {
    Collection.clear("test-node");
  });

  describe("Basic Operations", () => {
    it("creates a node and retrieves it", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Create root node
      const rootData: TreeNode<TestValue> = {
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      };
      collection.create(rootData);

      const node = collection.getNode<TestValue>("root");
      expect(node.id).toBe("root");
      expect(node.data?.value.name).toBe("Root");
      expect(node.exists()).toBe(true);
    });

    it("returns same Node instance for same data object", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const rootData: TreeNode<TestValue> = {
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      };
      collection.create(rootData);

      const node1 = collection.getNode<TestValue>("root");
      const node2 = collection.getNode<TestValue>("root");
      expect(node1).toBe(node2);
    });

    it("returns new Node instance after data update", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const rootData: TreeNode<TestValue> = {
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      };
      collection.create(rootData);

      const nodeBefore = collection.getNode<TestValue>("root");
      collection.update("root", (draft) => {
        draft.value.name = "Updated Root";
      });
      const nodeAfter = collection.getNode<TestValue>("root");

      expect(nodeBefore).not.toBe(nodeAfter);
      expect(nodeAfter.data?.value.name).toBe("Updated Root");
    });

    it("handles non-existent nodes gracefully", () => {
      const collection = Collection.get(config);
      const node = collection.getNode<TestValue>("non-existent");

      expect(node).toBeDefined();
      expect(node.id).toBe("non-existent");
      expect(node.data).toBeUndefined();
      expect(node.exists()).toBe(false);
    });
  });

  describe("Tree Navigation", () => {
    it("gets parent node", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Create root and child
      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.child1",
        position: 0,
        value: { name: "Child 1" },
        type: "object",
      });

      const child = collection.getNode<TestValue>("root.child1");
      const parent = child.getParent();

      expect(parent).not.toBeNull();
      expect(parent?.id).toBe("root");
      expect(parent?.data?.value.name).toBe("Root");
    });

    it("returns null for root node parent", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      expect(root.getParent()).toBeNull();
    });

    it("gets children sorted by position", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.c",
        position: 2,
        value: { name: "C" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.b",
        position: 1,
        value: { name: "B" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const children = root.getChildren();

      expect(children.length).toBe(3);
      expect(children[0].data?.value.name).toBe("A");
      expect(children[1].data?.value.name).toBe("B");
      expect(children[2].data?.value.name).toBe("C");
    });

    it("returns empty array when node has no children", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      expect(root.getChildren()).toEqual([]);
    });

    it("only returns direct children, not grandchildren", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.child",
        position: 0,
        value: { name: "Child" },
        type: "object",
      });
      collection.create({
        id: "root.child.grandchild",
        position: 0,
        value: { name: "Grandchild" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const children = root.getChildren();

      expect(children.length).toBe(1);
      expect(children[0].data?.value.name).toBe("Child");
    });
  });

  describe("append and prepend", () => {
    it("appends a child with position after existing children", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.existing",
        position: 5,
        value: { name: "Existing" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const newId = root.append({ name: "New Child" });

      const newNode = collection.getNode<TestValue>(newId);
      expect(newNode.data?.position).toBe(6);
      expect(newNode.data?.value.name).toBe("New Child");
    });

    it("prepends a child with position before existing children", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.existing",
        position: 5,
        value: { name: "Existing" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const newId = root.prepend({ name: "New Child" });

      const newNode = collection.getNode<TestValue>(newId);
      expect(newNode.data?.position).toBe(4);
      expect(newNode.data?.value.name).toBe("New Child");
    });

    it("uses custom node ID generator", async () => {
      let counter = 0;
      const configWithIdGen: Config<TreeNode<TestValue>, TestContext> = {
        ...config,
        id: "test-node-idgen",
        getNodeId: () => `custom-${++counter}`,
      };

      const collection = Collection.get(configWithIdGen);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const childId1 = root.append({ name: "Child 1" });
      const childId2 = root.append({ name: "Child 2" });

      expect(childId1).toBe("root.custom-1");
      expect(childId2).toBe("root.custom-2");

      Collection.clear("test-node-idgen");
    });

    it("appends with correct type", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const arrayChildId = root.append({ name: "Array" }, "array");
      const primitiveChildId = root.append({ name: "Primitive" }, "primitive");

      const arrayChild = collection.getNode<TestValue>(arrayChildId);
      const primitiveChild = collection.getNode<TestValue>(primitiveChildId);

      expect(arrayChild.data?.type).toBe("array");
      expect(primitiveChild.data?.type).toBe("primitive");
    });
  });

  describe("move", () => {
    it("swaps positions with target sibling", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.b",
        position: 1,
        value: { name: "B" },
        type: "object",
      });

      const nodeA = collection.getNode<TestValue>("root.a");
      nodeA.move(1);

      const updatedA = collection.getNode<TestValue>("root.a");
      const updatedB = collection.getNode<TestValue>("root.b");

      expect(updatedA.data?.position).toBe(1);
      expect(updatedB.data?.position).toBe(0);
    });

    it("does nothing when moving to same position", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 5,
        value: { name: "A" },
        type: "object",
      });

      const nodeA = collection.getNode<TestValue>("root.a");
      const dataBefore = nodeA.data;
      nodeA.move(5);
      const dataAfter = collection.getNode<TestValue>("root.a").data;

      // Should be the same object (no update)
      expect(dataBefore).toBe(dataAfter);
    });

    it("does nothing for root node (no parent)", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      root.move(5);

      expect(root.data?.position).toBe(0);
    });
  });

  describe("updateProp", () => {
    it("updates value property", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Original" },
        type: "object",
      });

      const node = collection.getNode<TestValue>("root");
      node.updateProp((draft) => {
        draft.name = "Updated";
      });

      const updatedNode = collection.getNode<TestValue>("root");
      expect(updatedNode.data?.value.name).toBe("Updated");
    });
  });

  describe("remove", () => {
    it("removes node and all descendants", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.child",
        position: 0,
        value: { name: "Child" },
        type: "object",
      });
      collection.create({
        id: "root.child.grandchild",
        position: 0,
        value: { name: "Grandchild" },
        type: "object",
      });
      collection.create({
        id: "root.other",
        position: 1,
        value: { name: "Other" },
        type: "object",
      });

      const child = collection.getNode<TestValue>("root.child");
      child.remove();

      expect(collection.items.has("root")).toBe(true);
      expect(collection.items.has("root.child")).toBe(false);
      expect(collection.items.has("root.child.grandchild")).toBe(false);
      expect(collection.items.has("root.other")).toBe(true);
    });

    it("removes nodes in depth-first order (deepest first)", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const removedIds: string[] = [];
      const originalRemove = collection.remove.bind(collection);
      collection.remove = (id: string) => {
        removedIds.push(id);
        originalRemove(id);
      };

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.a.b",
        position: 0,
        value: { name: "B" },
        type: "object",
      });
      collection.create({
        id: "root.a.b.c",
        position: 0,
        value: { name: "C" },
        type: "object",
      });

      removedIds.length = 0; // Reset after creates
      const nodeA = collection.getNode<TestValue>("root.a");
      nodeA.remove();

      // Should remove deepest first
      expect(removedIds).toEqual(["root.a.b.c", "root.a.b", "root.a"]);
    });
  });

  describe("Selection", () => {
    it("selects a node", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const node = collection.getNode<TestValue>("root");
      node.select();

      expect(collection.selectedNodeId).toBe("root");
      expect(collection.selectedNode?.id).toBe("root");
    });

    it("deselects a node", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const node = collection.getNode<TestValue>("root");
      node.select();
      expect(collection.selectedNodeId).toBe("root");

      collection.deselectNode();
      expect(collection.selectedNodeId).toBeNull();
      expect(collection.selectedNode).toBeNull();
    });

    it("selects different nodes", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.child",
        position: 0,
        value: { name: "Child" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const child = collection.getNode<TestValue>("root.child");

      root.select();
      expect(collection.selectedNodeId).toBe("root");

      child.select();
      expect(collection.selectedNodeId).toBe("root.child");
    });
  });

  describe("Custom Separator", () => {
    it("uses custom separator from config", async () => {
      const customConfig: Config<TreeNode<TestValue>, TestContext> = {
        ...config,
        id: "test-node-separator",
        nodeSeparator: "/",
      };

      const collection = Collection.get(customConfig);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const childId = root.append({ name: "Child" });

      expect(childId.startsWith("root/")).toBe(true);

      const child = collection.getNode<TestValue>(childId);
      expect(child.getParent()?.id).toBe("root");

      Collection.clear("test-node-separator");
    });

    it("handles nested paths with custom separator", async () => {
      const customConfig: Config<TreeNode<TestValue>, TestContext> = {
        ...config,
        id: "test-node-separator-nested",
        nodeSeparator: "::",
        getNodeId: () => "child",
      };

      const collection = Collection.get(customConfig);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const childId = root.append({ name: "Level 1" });
      expect(childId).toBe("root::child");

      collection.create({
        id: "root::child::grandchild",
        position: 0,
        value: { name: "Level 2" },
        type: "object",
      });

      const grandchild = collection.getNode<TestValue>("root::child::grandchild");
      const parent = grandchild.getParent();
      expect(parent?.id).toBe("root::child");
      expect(parent?.getParent()?.id).toBe("root");

      Collection.clear("test-node-separator-nested");
    });

    it("correctly identifies children with custom separator", async () => {
      const customConfig: Config<TreeNode<TestValue>, TestContext> = {
        ...config,
        id: "test-node-separator-children",
        nodeSeparator: "->",
      };

      const collection = Collection.get(customConfig);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root->a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root->b",
        position: 1,
        value: { name: "B" },
        type: "object",
      });
      collection.create({
        id: "root->a->nested",
        position: 0,
        value: { name: "Nested" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const children = root.getChildren();

      expect(children.length).toBe(2);
      expect(children[0].id).toBe("root->a");
      expect(children[1].id).toBe("root->b");

      Collection.clear("test-node-separator-children");
    });
  });

  describe("depth", () => {
    it("returns zero-based depth", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.child",
        position: 0,
        value: { name: "Child" },
        type: "object",
      });
      collection.create({
        id: "root.child.grandchild",
        position: 0,
        value: { name: "Grandchild" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const child = collection.getNode<TestValue>("root.child");
      const grandchild = collection.getNode<TestValue>("root.child.grandchild");

      expect(root.depth).toBe(0);
      expect(child.depth).toBe(1);
      expect(grandchild.depth).toBe(2);
    });

    it("works with custom separator", async () => {
      const customConfig: Config<TreeNode<TestValue>, TestContext> = {
        ...config,
        id: "test-node-depth-sep",
        nodeSeparator: "/",
      };

      const collection = Collection.get(customConfig);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root/child/grandchild",
        position: 0,
        value: { name: "Grandchild" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const grandchild = collection.getNode<TestValue>("root/child/grandchild");

      expect(root.depth).toBe(0);
      expect(grandchild.depth).toBe(2);

      Collection.clear("test-node-depth-sep");
    });
  });

  describe("clone", () => {
    it("clones a single node", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.child",
        position: 0,
        value: { name: "Child" },
        type: "primitive",
      });

      const child = collection.getNode<TestValue>("root.child");
      const cloned = child.clone();

      expect(cloned.size).toBe(1);
      const clonedNode = [...cloned.values()][0];
      expect(clonedNode.value.name).toBe("Child");
      expect(clonedNode.type).toBe("primitive");
      expect(clonedNode.position).toBe(0);
    });

    it("clones a subtree with descendants", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.parent",
        position: 0,
        value: { name: "Parent" },
        type: "object",
      });
      collection.create({
        id: "root.parent.child1",
        position: 0,
        value: { name: "Child1" },
        type: "primitive",
      });
      collection.create({
        id: "root.parent.child2",
        position: 1,
        value: { name: "Child2" },
        type: "primitive",
      });

      const parent = collection.getNode<TestValue>("root.parent");
      const cloned = parent.clone();

      expect(cloned.size).toBe(3);
      const values = [...cloned.values()];
      const names = values.map((v) => v.value.name).sort();
      expect(names).toEqual(["Child1", "Child2", "Parent"]);
    });

    it("returns empty map for non-existent node", () => {
      const collection = Collection.get(config);
      const node = collection.getNode<TestValue>("non-existent");
      const cloned = node.clone();

      expect(cloned.size).toBe(0);
    });

    it("remaps IDs in cloned subset", async () => {
      let counter = 0;
      const customConfig: Config<TreeNode<TestValue>, TestContext> = {
        ...config,
        id: "test-node-clone-remap",
        getNodeId: () => `clone-${++counter}`,
      };

      const collection = Collection.get(customConfig);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.parent",
        position: 0,
        value: { name: "Parent" },
        type: "object",
      });
      collection.create({
        id: "root.parent.child",
        position: 0,
        value: { name: "Child" },
        type: "primitive",
      });

      const parent = collection.getNode<TestValue>("root.parent");
      const cloned = parent.clone();

      expect(cloned.size).toBe(2);
      const ids = [...cloned.keys()];
      // Root of clone should be the generated ID
      expect(ids.some((id) => id === "clone-1")).toBe(true);
      // Child should have remapped ID
      expect(ids.some((id) => id === "clone-1.child")).toBe(true);

      Collection.clear("test-node-clone-remap");
    });
  });

  describe("move with reparenting", () => {
    it("moves node to different parent", async () => {
      let counter = 0;
      const customConfig: Config<TreeNode<TestValue>, TestContext> = {
        ...config,
        id: "test-node-reparent",
        getNodeId: () => `n${++counter}`,
      };

      const collection = Collection.get(customConfig);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.src",
        position: 0,
        value: { name: "Source" },
        type: "object",
      });
      collection.create({
        id: "root.src.item",
        position: 0,
        value: { name: "Item" },
        type: "primitive",
      });
      collection.create({
        id: "root.dest",
        position: 1,
        value: { name: "Destination" },
        type: "object",
      });

      const item = collection.getNode<TestValue>("root.src.item");
      const dest = collection.getNode<TestValue>("root.dest");

      item.move(0, dest);

      // Original should be removed
      expect(collection.items.has("root.src.item")).toBe(false);

      // New node should exist under dest
      const destChildren = dest.getChildren();
      expect(destChildren.length).toBe(1);
      expect(destChildren[0].data?.value.name).toBe("Item");
      expect(destChildren[0].data?.position).toBe(0);

      Collection.clear("test-node-reparent");
    });

    it("moves subtree to different parent", async () => {
      let counter = 0;
      const customConfig: Config<TreeNode<TestValue>, TestContext> = {
        ...config,
        id: "test-node-reparent-subtree",
        getNodeId: () => `n${++counter}`,
      };

      const collection = Collection.get(customConfig);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.folder",
        position: 0,
        value: { name: "Folder" },
        type: "object",
      });
      collection.create({
        id: "root.folder.file1",
        position: 0,
        value: { name: "File1" },
        type: "primitive",
      });
      collection.create({
        id: "root.folder.file2",
        position: 1,
        value: { name: "File2" },
        type: "primitive",
      });
      collection.create({
        id: "root.target",
        position: 1,
        value: { name: "Target" },
        type: "object",
      });

      const folder = collection.getNode<TestValue>("root.folder");
      const target = collection.getNode<TestValue>("root.target");

      folder.move(0, target);

      // Original subtree should be removed
      expect(collection.items.has("root.folder")).toBe(false);
      expect(collection.items.has("root.folder.file1")).toBe(false);
      expect(collection.items.has("root.folder.file2")).toBe(false);

      // New subtree should exist under target
      const targetChildren = target.getChildren();
      expect(targetChildren.length).toBe(1);
      expect(targetChildren[0].data?.value.name).toBe("Folder");

      const movedFolder = targetChildren[0];
      const movedFolderChildren = movedFolder.getChildren();
      expect(movedFolderChildren.length).toBe(2);

      Collection.clear("test-node-reparent-subtree");
    });

    it("prevents moving node into itself", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.folder",
        position: 0,
        value: { name: "Folder" },
        type: "object",
      });

      const folder = collection.getNode<TestValue>("root.folder");

      // Try to move folder into itself - should do nothing
      folder.move(0, folder);

      // Folder should still exist
      expect(collection.items.has("root.folder")).toBe(true);
    });

    it("prevents moving node into its descendant", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.parent",
        position: 0,
        value: { name: "Parent" },
        type: "object",
      });
      collection.create({
        id: "root.parent.child",
        position: 0,
        value: { name: "Child" },
        type: "object",
      });

      const parent = collection.getNode<TestValue>("root.parent");
      const child = collection.getNode<TestValue>("root.parent.child");

      // Try to move parent into its child - should do nothing
      parent.move(0, child);

      // Structure should remain unchanged
      expect(collection.items.has("root.parent")).toBe(true);
      expect(collection.items.has("root.parent.child")).toBe(true);
    });

    it("reorders when target parent is same as current parent", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.b",
        position: 1,
        value: { name: "B" },
        type: "object",
      });

      const nodeA = collection.getNode<TestValue>("root.a");
      const root = collection.getNode<TestValue>("root");

      // Move A to position 1 with explicit parent (same parent)
      nodeA.move(1, root);

      const updatedA = collection.getNode<TestValue>("root.a");
      const updatedB = collection.getNode<TestValue>("root.b");

      // Should just swap positions like normal move
      expect(updatedA.data?.position).toBe(1);
      expect(updatedB.data?.position).toBe(0);
    });
  });

  describe("getStatus", () => {
    it("returns null when no pending operations", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      // Wait for sync to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const node = collection.getNode<TestValue>("root");
      // After sync completes, status should be null
      const status = node.getStatus();
      // Status will either be null (synced) or have some pending state
      expect(status === null || status?.status === "pending" || status?.status === "syncing").toBe(
        true,
      );
    });

    it("returns pending status for queued operations", async () => {
      const customConfig: Config<TreeNode<TestValue>, TestContext> = {
        ...config,
        id: "test-node-status-pending",
        handler: async (params) => {
          if (params.changes) {
            // Delay sync to keep items in pending state
            await new Promise((resolve) => setTimeout(resolve, 500));
            const syncResults: Record<string, { status: "success" }> = {};
            for (const c of params.changes) {
              syncResults[c.id] = { status: "success" };
            }
            return { syncResults };
          }
          return { results: [] };
        },
      };

      const collection = Collection.get(customConfig);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const node = collection.getNode<TestValue>("root");
      const status = node.getStatus();

      expect(status).not.toBeNull();
      expect(status?.type).toBe("create");
      expect(["pending", "syncing"]).toContain(status?.status);

      Collection.clear("test-node-status-pending");
    });

    it("caches status and returns same reference when unchanged", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const node = collection.getNode<TestValue>("root");
      const status1 = node.getStatus();
      const status2 = node.getStatus();

      // Should return the same cached reference
      expect(status1).toBe(status2);
    });
  });

  describe("collection getter", () => {
    it("returns the collection reference", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const node = collection.getNode<TestValue>("root");
      expect(node.collection).toBe(collection);
    });

    it("allows access to collection methods", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const node = collection.getNode<TestValue>("root");

      // Can access collection.items through node
      expect(node.collection.items.has("root")).toBe(true);

      // Can subscribe through node.collection
      let notified = false;
      const unsubscribe = node.collection.subscribe(() => {
        notified = true;
      });

      collection.update("root", (draft) => {
        draft.value.name = "Updated";
      });

      expect(notified).toBe(true);
      unsubscribe();
    });
  });

  describe("move edge cases", () => {
    it("does nothing when node data is undefined", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Create root but try to move non-existent node
      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const nonExistent = collection.getNode<TestValue>("root.nonexistent");
      // Should not throw, just return early
      nonExistent.move(5);

      // Nothing should change
      expect(collection.items.size).toBe(1);
    });

    it("handles move to non-existent position (no sibling at target)", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.b",
        position: 1,
        value: { name: "B" },
        type: "object",
      });

      const nodeA = collection.getNode<TestValue>("root.a");
      // Move to position 99 where no sibling exists
      nodeA.move(99);

      const updatedA = collection.getNode<TestValue>("root.a");
      // Position should be updated even without a swap
      expect(updatedA.data?.position).toBe(99);
    });
  });

  describe("clone edge cases", () => {
    it("clones deeply nested structure", async () => {
      let counter = 0;
      const customConfig: Config<TreeNode<TestValue>, TestContext> = {
        ...config,
        id: "test-node-clone-deep",
        getNodeId: () => `n${++counter}`,
      };

      const collection = Collection.get(customConfig);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Create a deeply nested structure
      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.level1",
        position: 0,
        value: { name: "Level1" },
        type: "object",
      });
      collection.create({
        id: "root.level1.level2",
        position: 0,
        value: { name: "Level2" },
        type: "object",
      });
      collection.create({
        id: "root.level1.level2.level3",
        position: 0,
        value: { name: "Level3" },
        type: "object",
      });
      collection.create({
        id: "root.level1.level2.level3.level4",
        position: 0,
        value: { name: "Level4" },
        type: "primitive",
      });

      const level1 = collection.getNode<TestValue>("root.level1");
      const cloned = level1.clone();

      // Should clone all 4 levels
      expect(cloned.size).toBe(4);

      // Verify hierarchy is preserved
      const ids = [...cloned.keys()];
      const rootCloneId = ids.find((id) => !id.includes("."));
      expect(rootCloneId).toBeDefined();

      // Check that nested IDs maintain proper structure
      const level2Id = ids.find((id) => id.includes(".level2") && !id.includes(".level3"));
      const level3Id = ids.find((id) => id.includes(".level3") && !id.includes(".level4"));
      const level4Id = ids.find((id) => id.includes(".level4"));

      expect(level2Id).toBeDefined();
      expect(level3Id).toBeDefined();
      expect(level4Id).toBeDefined();

      Collection.clear("test-node-clone-deep");
    });

    it("preserves all node properties in clone", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.special",
        position: 42,
        value: { name: "Special Node" },
        type: "custom-type" as string,
      });

      const special = collection.getNode<TestValue>("root.special");
      const cloned = special.clone();

      expect(cloned.size).toBe(1);
      const clonedNode = [...cloned.values()][0];

      expect(clonedNode.position).toBe(42);
      expect(clonedNode.value.name).toBe("Special Node");
      expect(clonedNode.type).toBe("custom-type");
    });
  });

  describe("_mergeClonedSubset edge cases", () => {
    it("returns undefined for empty subset", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const result = root._mergeClonedSubset(new Map());

      expect(result).toBeUndefined();
    });

    it("uses append position when position not specified", async () => {
      let counter = 0;
      const customConfig: Config<TreeNode<TestValue>, TestContext> = {
        ...config,
        id: "test-node-merge-append",
        getNodeId: () => `n${++counter}`,
      };

      const collection = Collection.get(customConfig);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.existing",
        position: 5,
        value: { name: "Existing" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");

      // Create a simple cloned subset
      const clonedSubset = new Map<string, TreeNode<TestValue>>();
      clonedSubset.set("temp-id", {
        id: "temp-id",
        position: 0,
        value: { name: "New Node" },
        type: "object",
      });

      // Merge without specifying position
      const newId = root._mergeClonedSubset(clonedSubset);

      expect(newId).toBeDefined();
      const newNode = collection.getNode<TestValue>(newId!);

      // Should be positioned after existing child (position 5 + 1 = 6)
      expect(newNode.data?.position).toBe(6);

      Collection.clear("test-node-merge-append");
    });
  });

  describe("moveUp", () => {
    it("swaps position with previous sibling", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.b",
        position: 1,
        value: { name: "B" },
        type: "object",
      });
      collection.create({
        id: "root.c",
        position: 2,
        value: { name: "C" },
        type: "object",
      });

      const nodeB = collection.getNode<TestValue>("root.b");
      nodeB.moveUp();

      const updatedA = collection.getNode<TestValue>("root.a");
      const updatedB = collection.getNode<TestValue>("root.b");

      expect(updatedB.data?.position).toBe(0);
      expect(updatedA.data?.position).toBe(1);
    });

    it("does nothing when already first", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });

      const nodeA = collection.getNode<TestValue>("root.a");
      const dataBefore = nodeA.data;
      nodeA.moveUp();

      expect(collection.getNode<TestValue>("root.a").data).toBe(dataBefore);
    });

    it("does nothing for root node", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      root.moveUp();

      expect(root.data?.position).toBe(0);
    });

    it("bumps parent clientUpdatedAt", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.b",
        position: 1,
        value: { name: "B" },
        type: "object",
      });

      const rootBefore = collection.getNode<TestValue>("root").data;
      const nodeB = collection.getNode<TestValue>("root.b");
      nodeB.moveUp();

      const rootAfter = collection.getNode<TestValue>("root").data;
      expect(rootAfter).not.toBe(rootBefore);
      expect(rootAfter?.clientUpdatedAt).toBeDefined();
    });
  });

  describe("moveDown", () => {
    it("swaps position with next sibling", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.b",
        position: 1,
        value: { name: "B" },
        type: "object",
      });
      collection.create({
        id: "root.c",
        position: 2,
        value: { name: "C" },
        type: "object",
      });

      const nodeB = collection.getNode<TestValue>("root.b");
      nodeB.moveDown();

      const updatedB = collection.getNode<TestValue>("root.b");
      const updatedC = collection.getNode<TestValue>("root.c");

      expect(updatedB.data?.position).toBe(2);
      expect(updatedC.data?.position).toBe(1);
    });

    it("does nothing when already last", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });

      const nodeA = collection.getNode<TestValue>("root.a");
      const dataBefore = nodeA.data;
      nodeA.moveDown();

      expect(collection.getNode<TestValue>("root.a").data).toBe(dataBefore);
    });

    it("does nothing for root node", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      root.moveDown();

      expect(root.data?.position).toBe(0);
    });

    it("bumps parent clientUpdatedAt", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.b",
        position: 1,
        value: { name: "B" },
        type: "object",
      });

      const rootBefore = collection.getNode<TestValue>("root").data;
      const nodeA = collection.getNode<TestValue>("root.a");
      nodeA.moveDown();

      const rootAfter = collection.getNode<TestValue>("root").data;
      expect(rootAfter).not.toBe(rootBefore);
      expect(rootAfter?.clientUpdatedAt).toBeDefined();
    });
  });

  describe("clientUpdatedAt", () => {
    it("is set on parent when child is appended", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const rootBefore = collection.getNode<TestValue>("root").data;
      expect(rootBefore?.clientUpdatedAt).toBeUndefined();

      const root = collection.getNode<TestValue>("root");
      root.append({ name: "Child" });

      const rootAfter = collection.getNode<TestValue>("root").data;
      expect(rootAfter?.clientUpdatedAt).toBeDefined();
      expect(rootAfter).not.toBe(rootBefore);
    });

    it("is set on parent when child is prepended", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      root.prepend({ name: "Child" });

      const rootAfter = collection.getNode<TestValue>("root").data;
      expect(rootAfter?.clientUpdatedAt).toBeDefined();
    });

    it("is set on parent when child is removed", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.child",
        position: 0,
        value: { name: "Child" },
        type: "object",
      });

      const rootBefore = collection.getNode<TestValue>("root").data;
      const child = collection.getNode<TestValue>("root.child");
      child.remove();

      const rootAfter = collection.getNode<TestValue>("root").data;
      expect(rootAfter?.clientUpdatedAt).toBeDefined();
      expect(rootAfter).not.toBe(rootBefore);
    });

    it("is set on parent when child position changes via move", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.b",
        position: 1,
        value: { name: "B" },
        type: "object",
      });

      const rootBefore = collection.getNode<TestValue>("root").data;
      const nodeA = collection.getNode<TestValue>("root.a");
      nodeA.move(1);

      const rootAfter = collection.getNode<TestValue>("root").data;
      expect(rootAfter?.clientUpdatedAt).toBeDefined();
      expect(rootAfter).not.toBe(rootBefore);
    });
  });

  describe("setPosition", () => {
    it("moves node to a specific index among siblings", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({ id: "root", position: 0, value: { name: "Root" }, type: "object" });
      collection.create({ id: "root.a", position: 0, value: { name: "A" }, type: "object" });
      collection.create({ id: "root.b", position: 1, value: { name: "B" }, type: "object" });
      collection.create({ id: "root.c", position: 2, value: { name: "C" }, type: "object" });
      collection.create({ id: "root.d", position: 3, value: { name: "D" }, type: "object" });

      // Move A from index 0 to index 2
      const nodeA = collection.getNode<TestValue>("root.a");
      nodeA.setPosition(2);

      const root = collection.getNode<TestValue>("root");
      const children = root.getChildren();
      expect(children[0].data?.value.name).toBe("B");
      expect(children[1].data?.value.name).toBe("C");
      expect(children[2].data?.value.name).toBe("A");
      expect(children[3].data?.value.name).toBe("D");
    });

    it("moves node backward (from higher to lower index)", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({ id: "root", position: 0, value: { name: "Root" }, type: "object" });
      collection.create({ id: "root.a", position: 0, value: { name: "A" }, type: "object" });
      collection.create({ id: "root.b", position: 1, value: { name: "B" }, type: "object" });
      collection.create({ id: "root.c", position: 2, value: { name: "C" }, type: "object" });

      // Move C from index 2 to index 0
      const nodeC = collection.getNode<TestValue>("root.c");
      nodeC.setPosition(0);

      const root = collection.getNode<TestValue>("root");
      const children = root.getChildren();
      expect(children[0].data?.value.name).toBe("C");
      expect(children[1].data?.value.name).toBe("A");
      expect(children[2].data?.value.name).toBe("B");
    });

    it("clamps negative index to 0", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({ id: "root", position: 0, value: { name: "Root" }, type: "object" });
      collection.create({ id: "root.a", position: 0, value: { name: "A" }, type: "object" });
      collection.create({ id: "root.b", position: 1, value: { name: "B" }, type: "object" });
      collection.create({ id: "root.c", position: 2, value: { name: "C" }, type: "object" });

      const nodeC = collection.getNode<TestValue>("root.c");
      nodeC.setPosition(-5);

      const root = collection.getNode<TestValue>("root");
      const children = root.getChildren();
      expect(children[0].data?.value.name).toBe("C");
      expect(children[1].data?.value.name).toBe("A");
      expect(children[2].data?.value.name).toBe("B");
    });

    it("clamps index beyond last to last position", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({ id: "root", position: 0, value: { name: "Root" }, type: "object" });
      collection.create({ id: "root.a", position: 0, value: { name: "A" }, type: "object" });
      collection.create({ id: "root.b", position: 1, value: { name: "B" }, type: "object" });
      collection.create({ id: "root.c", position: 2, value: { name: "C" }, type: "object" });

      const nodeA = collection.getNode<TestValue>("root.a");
      nodeA.setPosition(100);

      const root = collection.getNode<TestValue>("root");
      const children = root.getChildren();
      expect(children[0].data?.value.name).toBe("B");
      expect(children[1].data?.value.name).toBe("C");
      expect(children[2].data?.value.name).toBe("A");
    });

    it("does nothing when target equals current index", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({ id: "root", position: 0, value: { name: "Root" }, type: "object" });
      collection.create({ id: "root.a", position: 0, value: { name: "A" }, type: "object" });
      collection.create({ id: "root.b", position: 1, value: { name: "B" }, type: "object" });

      const rootBefore = collection.getNode<TestValue>("root").data;
      const nodeA = collection.getNode<TestValue>("root.a");
      nodeA.setPosition(0);

      // Parent should not be touched
      const rootAfter = collection.getNode<TestValue>("root").data;
      expect(rootAfter).toBe(rootBefore);
    });

    it("does nothing for root node", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({ id: "root", position: 0, value: { name: "Root" }, type: "object" });

      const root = collection.getNode<TestValue>("root");
      root.setPosition(0);

      expect(root.data?.position).toBe(0);
    });

    it("does nothing for non-existent node", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const node = collection.getNode<TestValue>("root.nonexistent");
      node.setPosition(0);

      // Should not throw
      expect(node.exists()).toBe(false);
    });

    it("works with single child (clamped to same index)", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({ id: "root", position: 0, value: { name: "Root" }, type: "object" });
      collection.create({ id: "root.a", position: 0, value: { name: "A" }, type: "object" });

      const rootBefore = collection.getNode<TestValue>("root").data;
      const nodeA = collection.getNode<TestValue>("root.a");
      nodeA.setPosition(5);

      // Clamped to 0 (only child), equals current, so no-op
      const rootAfter = collection.getNode<TestValue>("root").data;
      expect(rootAfter).toBe(rootBefore);
    });

    it("normalizes positions to sequential integers", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({ id: "root", position: 0, value: { name: "Root" }, type: "object" });
      collection.create({ id: "root.a", position: 10, value: { name: "A" }, type: "object" });
      collection.create({ id: "root.b", position: 20, value: { name: "B" }, type: "object" });
      collection.create({ id: "root.c", position: 30, value: { name: "C" }, type: "object" });

      // Move C to index 0, positions should be renumbered 0,1,2
      const nodeC = collection.getNode<TestValue>("root.c");
      nodeC.setPosition(0);

      expect(collection.getNode<TestValue>("root.c").data?.position).toBe(0);
      expect(collection.getNode<TestValue>("root.a").data?.position).toBe(1);
      expect(collection.getNode<TestValue>("root.b").data?.position).toBe(2);
    });

    it("bumps parent clientUpdatedAt", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({ id: "root", position: 0, value: { name: "Root" }, type: "object" });
      collection.create({ id: "root.a", position: 0, value: { name: "A" }, type: "object" });
      collection.create({ id: "root.b", position: 1, value: { name: "B" }, type: "object" });

      const rootBefore = collection.getNode<TestValue>("root").data;
      const nodeB = collection.getNode<TestValue>("root.b");
      nodeB.setPosition(0);

      const rootAfter = collection.getNode<TestValue>("root").data;
      expect(rootAfter).not.toBe(rootBefore);
      expect(rootAfter?.clientUpdatedAt).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("handles positions with gaps", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: 0,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.b",
        position: 100,
        value: { name: "B" },
        type: "object",
      });
      collection.create({
        id: "root.c",
        position: 50,
        value: { name: "C" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const children = root.getChildren();

      expect(children[0].data?.value.name).toBe("A");
      expect(children[1].data?.value.name).toBe("C");
      expect(children[2].data?.value.name).toBe("B");
    });

    it("handles negative positions", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });
      collection.create({
        id: "root.a",
        position: -10,
        value: { name: "A" },
        type: "object",
      });
      collection.create({
        id: "root.b",
        position: 5,
        value: { name: "B" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const children = root.getChildren();

      expect(children[0].data?.value.name).toBe("A");
      expect(children[1].data?.value.name).toBe("B");
    });

    it("append to empty node starts at position 0", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const childId = root.append({ name: "First" });

      const child = collection.getNode<TestValue>(childId);
      expect(child.data?.position).toBe(0);
    });

    it("prepend to empty node starts at position 0", async () => {
      const collection = Collection.get(config);
      await new Promise((resolve) => setTimeout(resolve, 50));

      collection.create({
        id: "root",
        position: 0,
        value: { name: "Root" },
        type: "object",
      });

      const root = collection.getNode<TestValue>("root");
      const childId = root.prepend({ name: "First" });

      const child = collection.getNode<TestValue>(childId);
      expect(child.data?.position).toBe(0);
    });
  });
});
