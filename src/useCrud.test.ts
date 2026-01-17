import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCrud, type Config } from "./useCrud";
import { Collection } from "./collection";

interface TestValue {
  id: string;
  name: string;
}

interface TestContext {
  filter?: string;
}

describe("useCrud", () => {
  let config: Config<TestValue, TestContext>;

  beforeEach(() => {
    config = {
      id: "test-crud",
      initialContext: {},
      getId: (item) => item.id,
      onFetch: async () => [],
    };
  });

  afterEach(() => {
    Collection.clear("test-crud");
  });

  describe("snapshot stability", () => {
    it("does not cause infinite loop - snapshot reference is stable when no changes occur", async () => {
      const { result, rerender } = renderHook(() => useCrud(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const firstItems = result.current.items;
      const firstContext = result.current.context;
      const firstSyncState = result.current.syncState;

      rerender();

      // Key assertion: same reference means no infinite loop
      // If useSyncExternalStore's getSnapshot returns a new object each time,
      // React will detect the change and re-render infinitely
      expect(result.current.items).toBe(firstItems);
      expect(result.current.context).toBe(firstContext);
      expect(result.current.syncState).toBe(firstSyncState);
    });

    it("snapshot reference is stable after data changes settle", async () => {
      const { result, rerender } = renderHook(() => useCrud(config));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Create an item
      act(() => {
        const collection = Collection.get(config);
        collection.create({ id: "item-1", name: "Test Item" });
      });

      const itemsAfterCreate = result.current.items;

      // Multiple rerenders should return the same reference
      rerender();
      expect(result.current.items).toBe(itemsAfterCreate);

      rerender();
      expect(result.current.items).toBe(itemsAfterCreate);

      rerender();
      expect(result.current.items).toBe(itemsAfterCreate);
    });
  });
});
