import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCrudTree, type TreeConfig } from "./useCrudTree";
import { Collection } from "./collection";

interface TestValue {
  name: string;
}

interface TestContext {
  filter?: string;
}

describe("useCrudTree", () => {
  let config: TreeConfig<TestValue, TestContext>;

  beforeEach(() => {
    config = {
      id: "test-crud-tree",
      initialContext: {},
      rootId: "root",
      handler: async () => ({ results: [] }),
    };
  });

  afterEach(() => {
    Collection.clear("test-crud-tree");
  });

  describe("snapshot stability", () => {
    it("does not cause infinite loop - snapshot reference is stable when no changes occur", async () => {
      const { result, rerender } = renderHook(() => useCrudTree(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const firstRootNode = result.current.rootNode;
      const firstContext = result.current.context;

      rerender();

      // Key assertion: same reference means no infinite loop
      // If useSyncExternalStore's getSnapshot returns a new object each time,
      // React will detect the change and re-render infinitely
      expect(result.current.rootNode).toBe(firstRootNode);
      expect(result.current.context).toBe(firstContext);
    });

    it("snapshot reference is stable after data changes settle", async () => {
      const { result, rerender } = renderHook(() => useCrudTree(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Create a root node
      act(() => {
        const collection = Collection.get(config);
        collection.create({
          id: "root",
          position: 0,
          value: { name: "Root" },
          type: "object",
        });
      });

      const rootNodeAfterCreate = result.current.rootNode;

      // Multiple rerenders should return the same reference
      rerender();
      expect(result.current.rootNode).toBe(rootNodeAfterCreate);

      rerender();
      expect(result.current.rootNode).toBe(rootNodeAfterCreate);

      rerender();
      expect(result.current.rootNode).toBe(rootNodeAfterCreate);
    });
  });

  describe("toJson", () => {
    it("returns null when root node does not exist", async () => {
      const { result } = renderHook(() => useCrudTree(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(result.current.toJson()).toBeNull();
    });

    it("serializes a single root node", async () => {
      const { result } = renderHook(() => useCrudTree(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      act(() => {
        const collection = Collection.get(config);
        collection.create({
          id: "root",
          position: 0,
          value: { name: "Root" },
          type: "object",
        });
      });

      const json = result.current.toJson();

      expect(json).toEqual({
        id: "root",
        type: "object",
        value: { name: "Root" },
      });
    });

    it("serializes root with children sorted by position", async () => {
      const { result } = renderHook(() => useCrudTree(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      act(() => {
        const collection = Collection.get(config);
        collection.create({
          id: "root",
          position: 0,
          value: { name: "Root" },
          type: "object",
        });
        // Create children in non-sequential order
        collection.create({
          id: "root.c",
          position: 2,
          value: { name: "C" },
          type: "primitive",
        });
        collection.create({
          id: "root.a",
          position: 0,
          value: { name: "A" },
          type: "primitive",
        });
        collection.create({
          id: "root.b",
          position: 1,
          value: { name: "B" },
          type: "primitive",
        });
      });

      const json = result.current.toJson() as {
        children: Array<{ id: string; value: { name: string } }>;
      };

      expect(json.children).toHaveLength(3);
      expect(json.children[0].value.name).toBe("A");
      expect(json.children[1].value.name).toBe("B");
      expect(json.children[2].value.name).toBe("C");
    });

    it("serializes nested tree structure", async () => {
      const { result } = renderHook(() => useCrudTree(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      act(() => {
        const collection = Collection.get(config);
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
      });

      const json = result.current.toJson() as {
        id: string;
        children: Array<{
          id: string;
          value: { name: string };
          children: Array<{ id: string; value: { name: string } }>;
        }>;
      };

      expect(json.id).toBe("root");
      expect(json.children).toHaveLength(1);
      expect(json.children[0].value.name).toBe("Parent");
      expect(json.children[0].children).toHaveLength(2);
      expect(json.children[0].children[0].value.name).toBe("Child1");
      expect(json.children[0].children[1].value.name).toBe("Child2");
    });

    it("excludes children array when node has no children", async () => {
      const { result } = renderHook(() => useCrudTree(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      act(() => {
        const collection = Collection.get(config);
        collection.create({
          id: "root",
          position: 0,
          value: { name: "Root" },
          type: "object",
        });
        collection.create({
          id: "root.leaf",
          position: 0,
          value: { name: "Leaf" },
          type: "primitive",
        });
      });

      const json = result.current.toJson() as {
        children: Array<{ children?: unknown[] }>;
      };

      // Leaf node should not have children property
      expect(json.children[0]).not.toHaveProperty("children");
    });

    it("works with custom separator", async () => {
      const customConfig: TreeConfig<TestValue, TestContext> = {
        ...config,
        id: "test-crud-tree-separator",
        nodeSeparator: "/",
      };

      const { result } = renderHook(() => useCrudTree(customConfig));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      act(() => {
        const collection = Collection.get(customConfig);
        collection.create({
          id: "root",
          position: 0,
          value: { name: "Root" },
          type: "object",
        });
        collection.create({
          id: "root/child",
          position: 0,
          value: { name: "Child" },
          type: "primitive",
        });
        collection.create({
          id: "root/child/grandchild",
          position: 0,
          value: { name: "Grandchild" },
          type: "primitive",
        });
      });

      const json = result.current.toJson() as {
        id: string;
        children: Array<{
          id: string;
          children: Array<{ id: string }>;
        }>;
      };

      expect(json.id).toBe("root");
      expect(json.children[0].id).toBe("root/child");
      expect(json.children[0].children[0].id).toBe("root/child/grandchild");

      Collection.clear("test-crud-tree-separator");
    });

    it("serializes deeply nested tree", async () => {
      const { result } = renderHook(() => useCrudTree(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      act(() => {
        const collection = Collection.get(config);
        collection.create({
          id: "root",
          position: 0,
          value: { name: "Level0" },
          type: "object",
        });
        collection.create({
          id: "root.l1",
          position: 0,
          value: { name: "Level1" },
          type: "object",
        });
        collection.create({
          id: "root.l1.l2",
          position: 0,
          value: { name: "Level2" },
          type: "object",
        });
        collection.create({
          id: "root.l1.l2.l3",
          position: 0,
          value: { name: "Level3" },
          type: "object",
        });
        collection.create({
          id: "root.l1.l2.l3.l4",
          position: 0,
          value: { name: "Level4" },
          type: "primitive",
        });
      });

      const json = result.current.toJson() as {
        value: { name: string };
        children: Array<{
          value: { name: string };
          children: Array<{
            value: { name: string };
            children: Array<{
              value: { name: string };
              children: Array<{ value: { name: string } }>;
            }>;
          }>;
        }>;
      };

      expect(json.value.name).toBe("Level0");
      expect(json.children[0].value.name).toBe("Level1");
      expect(json.children[0].children[0].value.name).toBe("Level2");
      expect(json.children[0].children[0].children[0].value.name).toBe("Level3");
      expect(json.children[0].children[0].children[0].children[0].value.name).toBe("Level4");
    });

    it("preserves node type in serialization", async () => {
      const { result } = renderHook(() => useCrudTree(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      act(() => {
        const collection = Collection.get(config);
        collection.create({
          id: "root",
          position: 0,
          value: { name: "Root" },
          type: "object",
        });
        collection.create({
          id: "root.array",
          position: 0,
          value: { name: "Array Node" },
          type: "array",
        });
        collection.create({
          id: "root.primitive",
          position: 1,
          value: { name: "Primitive Node" },
          type: "primitive",
        });
      });

      const json = result.current.toJson() as {
        type: string;
        children: Array<{ type: string }>;
      };

      expect(json.type).toBe("object");
      expect(json.children[0].type).toBe("array");
      expect(json.children[1].type).toBe("primitive");
    });

    it("updates when tree structure changes", async () => {
      const { result } = renderHook(() => useCrudTree(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      act(() => {
        const collection = Collection.get(config);
        collection.create({
          id: "root",
          position: 0,
          value: { name: "Root" },
          type: "object",
        });
      });

      const json1 = result.current.toJson() as { children?: unknown[] };
      expect(json1.children).toBeUndefined();

      // Add a child
      act(() => {
        const collection = Collection.get(config);
        collection.create({
          id: "root.child",
          position: 0,
          value: { name: "Child" },
          type: "primitive",
        });
      });

      const json2 = result.current.toJson() as {
        children: Array<{ value: { name: string } }>;
      };
      expect(json2.children).toHaveLength(1);
      expect(json2.children[0].value.name).toBe("Child");
    });

    it("handles multiple children at different levels", async () => {
      const { result } = renderHook(() => useCrudTree(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      act(() => {
        const collection = Collection.get(config);
        // Root with 2 children, each with 2 grandchildren
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
          id: "root.a.a1",
          position: 0,
          value: { name: "A1" },
          type: "primitive",
        });
        collection.create({
          id: "root.a.a2",
          position: 1,
          value: { name: "A2" },
          type: "primitive",
        });
        collection.create({
          id: "root.b.b1",
          position: 0,
          value: { name: "B1" },
          type: "primitive",
        });
        collection.create({
          id: "root.b.b2",
          position: 1,
          value: { name: "B2" },
          type: "primitive",
        });
      });

      const json = result.current.toJson() as {
        children: Array<{
          value: { name: string };
          children: Array<{ value: { name: string } }>;
        }>;
      };

      expect(json.children).toHaveLength(2);
      expect(json.children[0].value.name).toBe("A");
      expect(json.children[0].children).toHaveLength(2);
      expect(json.children[0].children[0].value.name).toBe("A1");
      expect(json.children[0].children[1].value.name).toBe("A2");
      expect(json.children[1].value.name).toBe("B");
      expect(json.children[1].children).toHaveLength(2);
      expect(json.children[1].children[0].value.name).toBe("B1");
      expect(json.children[1].children[1].value.name).toBe("B2");
    });
  });
});
