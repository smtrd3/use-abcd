import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Collection } from "./collection";
import type { Config } from "./types";

interface TestItem {
  id: string;
  name: string;
  value: number;
}

interface TestContext {
  filter?: string;
}

describe("Item Cache with WeakMap", () => {
  let config: Config<TestItem, TestContext>;

  beforeEach(() => {
    config = {
      id: "test-item-cache",
      initialContext: {},
      getId: (item) => item.id,
      onFetch: async () => [
        { id: "1", name: "Item 1", value: 100 },
        { id: "2", name: "Item 2", value: 200 },
      ],
    };
  });

  afterEach(() => {
    Collection.clear("test-item-cache");
  });

  describe("Cache Behavior", () => {
    it("returns same Item instance when data object hasn't changed", async () => {
      const collection = Collection.get(config);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Get item twice - should return same instance
      const item1 = collection.getItem("1");
      const item2 = collection.getItem("1");

      expect(item1).toBe(item2);
    });

    it("returns new Item instance when data object changes (update)", async () => {
      const collection = Collection.get(config);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Get item before update
      const itemBefore = collection.getItem("1");
      const valueBefore = itemBefore.data?.value;

      // Update the item (creates new data object)
      collection.update("1", (draft) => {
        draft.value = 150;
      });

      // Get item after update - should return new instance
      const itemAfter = collection.getItem("1");

      expect(itemBefore).not.toBe(itemAfter);
      // Note: itemBefore.data is a getter that always returns current state
      // So we stored the value before the update to test it
      expect(valueBefore).toBe(100);
      expect(itemAfter.data?.value).toBe(150);
      // Both items now show updated data since data is a getter
      expect(itemBefore.data?.value).toBe(150);
    });

    it("handles non-existent items gracefully", () => {
      const collection = Collection.get(config);

      // Get item that doesn't exist
      const item = collection.getItem("non-existent");

      expect(item).toBeDefined();
      expect(item.id).toBe("non-existent");
      expect(item.data).toBeUndefined();
      expect(item.exists()).toBe(false);
    });

    it("caches items by data object reference, not by ID", async () => {
      const collection = Collection.get(config);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Get items
      const item1a = collection.getItem("1");
      const item2a = collection.getItem("2");

      // Different IDs = different items
      expect(item1a).not.toBe(item2a);

      // Same ID = same item (data hasn't changed)
      const item1b = collection.getItem("1");
      expect(item1a).toBe(item1b);
    });
  });

  describe("Cache Invalidation on Data Changes", () => {
    it("creates new Item after create operation", async () => {
      const collection = Collection.get(config);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Create new item
      const newItem: TestItem = { id: "3", name: "Item 3", value: 300 };
      collection.create(newItem);

      // Get the created item - should exist in cache
      const item1 = collection.getItem("3");
      expect(item1.data).toEqual(newItem);

      // Get again - should return same instance (data hasn't changed)
      const item2 = collection.getItem("3");
      expect(item1).toBe(item2);
    });

    it("creates new Item after ID remapping", async () => {
      const configWithSync: Config<TestItem, TestContext> = {
        ...config,
        onSync: async (changes) => {
          return changes.map((change) => {
            if (change.type === "create") {
              // Simulate server assigning permanent ID
              return {
                id: change.id,
                status: "success" as const,
                newId: `server-${change.id}`,
              };
            }
            return { id: change.id, status: "success" as const };
          });
        },
      };

      const collection = Collection.get(configWithSync);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Create item with temp ID
      const tempItem: TestItem = { id: "temp-123", name: "Temp Item", value: 999 };
      collection.create(tempItem);

      // Get item with temp ID
      const itemWithTempId = collection.getItem("temp-123");
      expect(itemWithTempId.id).toBe("temp-123");
      expect(itemWithTempId.data?.name).toBe("Temp Item");

      // Wait for sync and ID remapping
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Temp ID should no longer exist
      expect(collection.items.has("temp-123")).toBe(false);

      // New ID should exist
      expect(collection.items.has("server-temp-123")).toBe(true);

      // Get item with new ID - should be a different Item instance
      const itemWithNewId = collection.getItem("server-temp-123");
      expect(itemWithNewId.id).toBe("server-temp-123");
      expect(itemWithNewId.data?.name).toBe("Temp Item");

      // Should be different instances (different data objects after remapping)
      expect(itemWithTempId).not.toBe(itemWithNewId);
    });

    it("returns new Item when data changes via refetch", async () => {
      let fetchCount = 0;
      const dynamicConfig: Config<TestItem, TestContext> = {
        ...config,
        onFetch: async () => {
          fetchCount++;
          return [
            { id: "1", name: "Item 1", value: fetchCount === 1 ? 100 : 150 },
            { id: "2", name: "Item 2", value: 200 },
          ];
        },
      };

      const collection = Collection.get(dynamicConfig);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Get item after first fetch
      const itemBeforeRefetch = collection.getItem("1");
      expect(itemBeforeRefetch.data?.value).toBe(100);

      // Trigger refetch
      await collection.refresh();

      // Wait for refetch to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Get item after refetch - data changed, should be new instance
      const itemAfterRefetch = collection.getItem("1");
      expect(itemAfterRefetch.data?.value).toBe(150);
      expect(itemBeforeRefetch).not.toBe(itemAfterRefetch);
    });
  });

  describe("React Optimization Pattern", () => {
    it("demonstrates React optimization: same data = same Item = no re-render", async () => {
      const collection = Collection.get(config);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      const renderCalls: {
        item: ReturnType<typeof collection.getItem>;
        data: TestItem | undefined;
      }[] = [];

      // Simulate multiple React renders
      for (let i = 0; i < 5; i++) {
        const item = collection.getItem("1");
        renderCalls.push({ item, data: item.data });
      }

      // All renders should get the same Item instance
      const firstItem = renderCalls[0].item;
      for (const call of renderCalls) {
        expect(call.item).toBe(firstItem);
      }
    });

    it("demonstrates React re-render trigger: new data = new Item = re-render", async () => {
      const collection = Collection.get(config);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      const renderCalls: { item: ReturnType<typeof collection.getItem>; valueAtTime: number }[] =
        [];

      // First render
      const item1 = collection.getItem("1");
      renderCalls.push({ item: item1, valueAtTime: item1.data?.value ?? 0 });

      // Update data
      collection.update("1", (draft) => {
        draft.value = 150;
      });

      // Second render - should get new Item instance
      const item2 = collection.getItem("1");
      renderCalls.push({ item: item2, valueAtTime: item2.data?.value ?? 0 });

      // Update again
      collection.update("1", (draft) => {
        draft.value = 200;
      });

      // Third render - should get another new Item instance
      const item3 = collection.getItem("1");
      renderCalls.push({ item: item3, valueAtTime: item3.data?.value ?? 0 });

      // All three should be different instances
      expect(renderCalls[0].item).not.toBe(renderCalls[1].item);
      expect(renderCalls[1].item).not.toBe(renderCalls[2].item);
      expect(renderCalls[0].item).not.toBe(renderCalls[2].item);

      // Values captured at each render should be correct
      expect(renderCalls[0].valueAtTime).toBe(100);
      expect(renderCalls[1].valueAtTime).toBe(150);
      expect(renderCalls[2].valueAtTime).toBe(200);

      // Note: All items' .data getters now return current state (200)
      // This is expected behavior - data is always current
      expect(renderCalls[0].item.data?.value).toBe(200);
      expect(renderCalls[1].item.data?.value).toBe(200);
      expect(renderCalls[2].item.data?.value).toBe(200);
    });
  });

  describe("Memory Management", () => {
    it("allows garbage collection when data object is no longer referenced", async () => {
      const collection = Collection.get(config);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Get item
      const item1 = collection.getItem("1");
      expect(item1.data).toBeDefined();

      // Update creates new data object, old one can be GC'd
      collection.update("1", (draft) => {
        draft.value = 999;
      });

      // Get new item instance
      const item2 = collection.getItem("1");
      expect(item2).not.toBe(item1);

      // Old item (item1) references old data object
      // When item1 goes out of scope, WeakMap allows GC of the entry
      // This is automatic and can't be directly tested, but we can verify
      // that the new item has the updated data
      expect(item2.data?.value).toBe(999);
    });

    it("doesn't prevent garbage collection of unused items", async () => {
      const collection = Collection.get(config);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Create many items
      for (let i = 10; i < 100; i++) {
        collection.create({ id: `${i}`, name: `Item ${i}`, value: i });
      }

      // Get some items (creates Item instances in WeakMap)
      for (let i = 10; i < 50; i++) {
        collection.getItem(`${i}`);
      }

      // Delete items - removes data objects from collection.items
      for (let i = 10; i < 50; i++) {
        collection.remove(`${i}`);
      }

      // Verify items are gone
      for (let i = 10; i < 50; i++) {
        expect(collection.items.has(`${i}`)).toBe(false);
      }

      // The Item instances in WeakMap will be GC'd automatically
      // since their data objects are no longer referenced
      // We can't directly test GC, but we verify the items are gone
      for (let i = 10; i < 50; i++) {
        const item = collection.getItem(`${i}`);
        expect(item.exists()).toBe(false);
        expect(item.data).toBeUndefined();
      }
    });
  });

  describe("Edge Cases", () => {
    it("handles rapid updates correctly", async () => {
      const collection = Collection.get(config);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      const items: ReturnType<typeof collection.getItem>[] = [];

      // Rapid updates
      for (let i = 0; i < 10; i++) {
        collection.update("1", (draft) => {
          draft.value = 100 + i;
        });
        items.push(collection.getItem("1"));
      }

      // Each update creates new data object, so each getItem should return new instance
      const uniqueItems = new Set(items);
      expect(uniqueItems.size).toBe(10);

      // Last item should have final value
      expect(items[items.length - 1].data?.value).toBe(109);
    });

    it("handles getItem called on deleted item", async () => {
      const collection = Collection.get(config);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Get item before deletion
      const itemBefore = collection.getItem("1");
      expect(itemBefore.exists()).toBe(true);

      // Delete the item
      collection.remove("1");

      // Get item after deletion - should return placeholder
      const itemAfter = collection.getItem("1");
      expect(itemAfter.exists()).toBe(false);
      expect(itemAfter.data).toBeUndefined();

      // Should be different instances
      expect(itemBefore).not.toBe(itemAfter);
    });

    it("handles context changes correctly", async () => {
      const contextConfig: Config<TestItem, TestContext> = {
        ...config,
        onFetch: async (context) => {
          if (context.filter === "high") {
            return [{ id: "2", name: "Item 2", value: 200 }];
          }
          return [
            { id: "1", name: "Item 1", value: 100 },
            { id: "2", name: "Item 2", value: 200 },
          ];
        },
      };

      const collection = Collection.get(contextConfig);

      // Wait for initial fetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Get items in initial context
      const item1Before = collection.getItem("1");
      const item2Before = collection.getItem("2");

      expect(item1Before.exists()).toBe(true);
      expect(item2Before.exists()).toBe(true);

      // Change context
      collection.setContext((draft) => {
        draft.filter = "high";
      });

      // Wait for refetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Item 1 should no longer exist
      const item1After = collection.getItem("1");
      expect(item1After.exists()).toBe(false);

      // Item 2 should still exist, but with new data object
      const item2After = collection.getItem("2");
      expect(item2After.exists()).toBe(true);

      // Should be different instances (new data objects after refetch)
      expect(item2Before).not.toBe(item2After);
    });
  });
});
