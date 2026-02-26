import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { useCrud, type Config } from "./useCrud";
import { Collection, buildServerSnapshot } from "./collection";

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
      handler: async () => ({ results: [] }),
    };
  });

  afterEach(() => {
    Collection.clear("test-crud");
  });

  describe("serverItems", () => {
    it("uses serverItems as initial data without fetching", async () => {
      const handler = vi.fn(async () => ({ results: [] }));
      const serverConfig: Config<TestValue, TestContext> = {
        id: "test-crud-server-items",
        initialContext: {},
        handler,
        serverItems: [
          { id: "1", name: "Server Item 1" },
          { id: "2", name: "Server Item 2" },
        ],
      };

      const { result } = renderHook(() => useCrud(serverConfig));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Items from serverItems should be available
      expect(result.current.items.size).toBe(2);
      expect(result.current.items.get("1")?.name).toBe("Server Item 1");
      expect(result.current.items.get("2")?.name).toBe("Server Item 2");

      // Handler should not have been called (no fetch)
      expect(handler).not.toHaveBeenCalled();

      Collection.clear("test-crud-server-items");
    });

    it("does not trigger fetch when serverItems is provided", async () => {
      const handler = vi.fn(async () => ({ results: [{ id: "3", name: "Fetched" }] }));
      const serverConfig: Config<TestValue, TestContext> = {
        id: "test-crud-no-fetch",
        initialContext: {},
        handler,
        serverItems: [{ id: "1", name: "Server Only" }],
      };

      const { result } = renderHook(() => useCrud(serverConfig));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      // Should still only have serverItems, not fetched data
      expect(result.current.items.size).toBe(1);
      expect(result.current.items.get("1")?.name).toBe("Server Only");
      expect(handler).not.toHaveBeenCalled();

      Collection.clear("test-crud-no-fetch");
    });
  });

  describe("buildServerSnapshot", () => {
    it("builds snapshot from serverItems", () => {
      const snapshot = buildServerSnapshot<TestValue, TestContext>({
        id: "test",
        initialContext: { filter: "active" },
        serverItems: [
          { id: "1", name: "Item 1" },
          { id: "2", name: "Item 2" },
        ],
      });

      expect(snapshot.items.size).toBe(2);
      expect(snapshot.items.get("1")?.name).toBe("Item 1");
      expect(snapshot.items.get("2")?.name).toBe("Item 2");
      expect(snapshot.context).toEqual({ filter: "active" });
      expect(snapshot.loading).toBe(false);
      expect(snapshot.syncing).toBe(false);
      expect(snapshot.syncState).toBe("idle");
      expect(snapshot.fetchStatus).toBe("idle");
    });

    it("builds empty snapshot when no serverItems", () => {
      const snapshot = buildServerSnapshot<TestValue, TestContext>({
        id: "test",
        initialContext: {},
      });

      expect(snapshot.items.size).toBe(0);
      expect(snapshot.loading).toBe(false);
      expect(snapshot.syncState).toBe("idle");
    });
  });

  describe("SSR hydration", () => {
    it("server and client snapshots match when serverItems is provided", () => {
      const ssrConfig: Config<TestValue, TestContext> = {
        id: "test-crud-ssr-match",
        initialContext: { filter: "active" },
        handler: async () => ({ results: [] }),
        serverItems: [
          { id: "1", name: "Item 1" },
          { id: "2", name: "Item 2" },
        ],
      };

      // Server snapshot (what getServerSnapshot returns)
      const serverSnapshot = buildServerSnapshot(ssrConfig);

      // Client snapshot (what getSnapshot returns after Collection.get)
      const collection = Collection.get(ssrConfig);
      const clientSnapshot = collection.getState();

      // Items must match
      expect(clientSnapshot.items.size).toBe(serverSnapshot.items.size);
      for (const [id, item] of serverSnapshot.items) {
        expect(clientSnapshot.items.get(id)).toEqual(item);
      }

      // Key state fields must match
      expect(clientSnapshot.loading).toBe(serverSnapshot.loading);
      expect(clientSnapshot.syncing).toBe(serverSnapshot.syncing);
      expect(clientSnapshot.syncState).toBe(serverSnapshot.syncState);
      expect(clientSnapshot.fetchStatus).toBe(serverSnapshot.fetchStatus);
      expect(clientSnapshot.context).toEqual(serverSnapshot.context);

      Collection.clear("test-crud-ssr-match");
    });

    it("produces matching HTML during renderToString and hydration", async () => {
      const ssrConfig: Config<TestValue, TestContext> = {
        id: "test-crud-ssr-hydration",
        initialContext: {},
        handler: async () => ({ results: [] }),
        serverItems: [
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
        ],
      };

      // Component that renders items from useCrud
      function ItemList() {
        const { items, loading } = useCrud(ssrConfig);
        if (loading) return React.createElement("div", null, "Loading...");
        const itemArray = Array.from(items.values());
        return React.createElement(
          "ul",
          null,
          ...itemArray.map((item) =>
            React.createElement("li", { key: item.id }, item.name),
          ),
        );
      }

      // 1. Server render
      const serverHtml = renderToString(React.createElement(ItemList));
      expect(serverHtml).toContain("Alice");
      expect(serverHtml).toContain("Bob");
      expect(serverHtml).not.toContain("Loading...");

      // 2. Set up client DOM with server HTML
      Collection.clear("test-crud-ssr-hydration");
      const container = document.createElement("div");
      document.body.appendChild(container);
      container.innerHTML = serverHtml;

      // 3. Hydrate — capture console.error to detect hydration mismatches
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await act(async () => {
        hydrateRoot(container, React.createElement(ItemList));
      });

      // 4. Verify no hydration mismatch errors
      const hydrationErrors = errorSpy.mock.calls.filter(
        (args) =>
          typeof args[0] === "string" &&
          (args[0].includes("Hydration") ||
            args[0].includes("hydrat") ||
            args[0].includes("did not match")),
      );
      expect(hydrationErrors).toHaveLength(0);

      // 5. Verify content is correct after hydration
      expect(container.innerHTML).toContain("Alice");
      expect(container.innerHTML).toContain("Bob");

      // Cleanup
      errorSpy.mockRestore();
      document.body.removeChild(container);
      Collection.clear("test-crud-ssr-hydration");
    });
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
        collection.create({ id: "test-1", name: "Test Item" });
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
