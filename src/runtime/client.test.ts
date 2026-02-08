import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSyncClient, syncSuccess, syncError } from "./client";

interface TestItem {
  id: string;
  name: string;
}

describe("Client Sync Utilities", () => {
  describe("Helper Functions", () => {
    it("syncSuccess returns success result", () => {
      expect(syncSuccess()).toEqual({ success: true });
      expect(syncSuccess({ newId: "abc" })).toEqual({ success: true, newId: "abc" });
    });

    it("syncError returns error result", () => {
      expect(syncError("Something went wrong")).toEqual({
        success: false,
        error: "Something went wrong",
      });
    });
  });

  describe("createSyncClient with handlers", () => {
    describe("Fetch Mode (no changes)", () => {
      it("returns empty queryResults when no fetch handler configured", async () => {
        const { onSync } = createSyncClient<TestItem>({});
        const signal = new AbortController().signal;

        const result = await onSync({ query: {}, context: undefined, signal });

        expect(result.queryResults).toEqual([]);
        expect(result.syncResults).toEqual([]);
      });

      it("uses fetch handler when provided", async () => {
        const items = [{ id: "1", name: "Item 1" }];
        const { onSync } = createSyncClient<TestItem>({
          fetch: async () => items,
        });
        const signal = new AbortController().signal;

        const result = await onSync({ query: { page: 1 }, context: undefined, signal });

        expect(result.queryResults).toEqual(items);
      });
    });

    describe("Sync Mode (with changes)", () => {
      it("returns success when create handler not configured", async () => {
        const { onSync } = createSyncClient<TestItem>({});
        const signal = new AbortController().signal;

        const result = await onSync({
          changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "New Item" } }],
          query: {},
          context: undefined,
          signal,
        });

        expect(result.syncResults).toHaveLength(1);
        expect(result.syncResults[0]).toEqual({ id: "temp-1", status: "success" });
      });

      it("uses configured handlers when available", async () => {
        const createFn = vi.fn().mockResolvedValue(syncSuccess({ newId: "server-1" }));
        const { onSync } = createSyncClient<TestItem>({ create: createFn });
        const signal = new AbortController().signal;

        const result = await onSync({
          changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "New" } }],
          query: {},
          context: undefined,
          signal,
        });

        expect(createFn).toHaveBeenCalledWith({ id: "temp-1", name: "New" }, signal);
        expect(result.syncResults[0]).toEqual({
          id: "temp-1",
          status: "success",
          newId: "server-1",
        });
      });

      it("handles create error", async () => {
        const { onSync } = createSyncClient<TestItem>({
          create: async () => syncError("Duplicate entry"),
        });
        const signal = new AbortController().signal;

        const result = await onSync({
          changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "Item" } }],
          query: {},
          context: undefined,
          signal,
        });

        expect(result.syncResults[0]).toEqual({
          id: "temp-1",
          status: "error",
          error: "Duplicate entry",
        });
      });

      it("handles update operations", async () => {
        const updateFn = vi.fn().mockResolvedValue(syncSuccess());
        const { onSync } = createSyncClient<TestItem>({ update: updateFn });
        const signal = new AbortController().signal;

        const result = await onSync({
          changes: [{ id: "1", type: "update", data: { id: "1", name: "Updated" } }],
          query: {},
          context: undefined,
          signal,
        });

        expect(result.syncResults[0]).toEqual({ id: "1", status: "success" });
        expect(updateFn).toHaveBeenCalledWith("1", { id: "1", name: "Updated" }, signal);
      });

      it("handles delete operations", async () => {
        const deleteFn = vi.fn().mockResolvedValue(syncSuccess());
        const { onSync } = createSyncClient<TestItem>({ delete: deleteFn });
        const signal = new AbortController().signal;

        const result = await onSync({
          changes: [{ id: "1", type: "delete", data: { id: "1", name: "Item" } }],
          query: {},
          context: undefined,
          signal,
        });

        expect(result.syncResults[0]).toEqual({ id: "1", status: "success" });
        expect(deleteFn).toHaveBeenCalledWith("1", { id: "1", name: "Item" }, signal);
      });

      it("handles mixed operation types", async () => {
        const { onSync } = createSyncClient<TestItem>({
          create: async () => syncSuccess({ newId: "new-1" }),
          update: async () => syncSuccess(),
          delete: async () => syncSuccess(),
        });
        const signal = new AbortController().signal;

        const result = await onSync({
          changes: [
            { id: "temp-1", type: "create", data: { id: "temp-1", name: "New" } },
            { id: "1", type: "update", data: { id: "1", name: "Updated" } },
            { id: "2", type: "delete", data: { id: "2", name: "Deleted" } },
          ],
          query: {},
          context: undefined,
          signal,
        });

        expect(result.syncResults[0].newId).toBe("new-1");
        expect(result.syncResults.every((r) => r.status === "success")).toBe(true);
      });

      it("returns error when already aborted", async () => {
        const { onSync } = createSyncClient<TestItem>({
          create: async () => syncSuccess(),
        });
        const controller = new AbortController();
        controller.abort();

        const result = await onSync({
          changes: [{ id: "1", type: "create", data: { id: "1", name: "Item" } }],
          query: {},
          context: undefined,
          signal: controller.signal,
        });

        expect(result.syncResults[0]).toEqual({ id: "1", status: "error", error: "Aborted" });
      });

      it("catches and returns handler exceptions", async () => {
        const { onSync } = createSyncClient<TestItem>({
          create: async () => {
            throw new Error("Unexpected error");
          },
        });
        const signal = new AbortController().signal;

        const result = await onSync({
          changes: [{ id: "1", type: "create", data: { id: "1", name: "Item" } }],
          query: {},
          context: undefined,
          signal,
        });

        expect(result.syncResults[0]).toEqual({
          id: "1",
          status: "error",
          error: "Unexpected error",
        });
      });
    });
  });

  describe("createSyncClient with endpoint", () => {
    const mockFetch = vi.fn();
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = mockFetch;
      mockFetch.mockReset();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("fetches data when no changes provided", async () => {
      const items = [{ id: "1", name: "Item 1" }];
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ queryResults: items }), { status: 200 }),
      );

      const { onSync } = createSyncClient<TestItem>({ endpoint: "/api/sync" });
      const signal = new AbortController().signal;

      const result = await onSync({ query: { page: 1 }, context: undefined, signal });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/sync",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ query: { page: 1 } }),
        }),
      );
      expect(result.queryResults).toEqual(items);
    });

    it("sends changes to endpoint and returns results", async () => {
      const syncResults = [
        { id: "1", status: "success", newId: "server-1" },
        { id: "2", status: "success" },
      ];
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ syncResults }), { status: 200 }));

      const { onSync } = createSyncClient<TestItem>({ endpoint: "/api/sync" });
      const signal = new AbortController().signal;

      const result = await onSync({
        changes: [
          { id: "1", type: "create", data: { id: "1", name: "New" } },
          { id: "2", type: "update", data: { id: "2", name: "Updated" } },
        ],
        context: undefined,
        signal,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/sync",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            changes: [
              { id: "1", type: "create", data: { id: "1", name: "New" } },
              { id: "2", type: "update", data: { id: "2", name: "Updated" } },
            ],
          }),
        }),
      );
      expect(result.syncResults).toEqual(syncResults);
    });

    it("accepts custom headers", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ queryResults: [] }), { status: 200 }),
      );

      const { onSync } = createSyncClient<TestItem>({
        endpoint: "/api/sync",
        headers: { Authorization: "Bearer token123" },
      });
      await onSync({ query: {}, context: undefined, signal: new AbortController().signal });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/sync",
        expect.objectContaining({
          headers: { "Content-Type": "application/json", Authorization: "Bearer token123" },
        }),
      );
    });

    it("returns error for all changes when response is not ok", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Server error" }), { status: 500 }),
      );

      const { onSync } = createSyncClient<TestItem>({ endpoint: "/api/sync" });
      const signal = new AbortController().signal;

      const result = await onSync({
        changes: [
          { id: "1", type: "create", data: { id: "1", name: "New" } },
          { id: "2", type: "update", data: { id: "2", name: "Updated" } },
        ],
        query: {},
        context: undefined,
        signal,
      });

      expect(result.syncResults).toEqual([
        { id: "1", status: "error", error: "Server error" },
        { id: "2", status: "error", error: "Server error" },
      ]);
    });

    it("throws error for fetch mode when response is not ok", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Server error" }), { status: 500 }),
      );

      const { onSync } = createSyncClient<TestItem>({ endpoint: "/api/sync" });
      const signal = new AbortController().signal;

      await expect(onSync({ query: {}, context: undefined, signal })).rejects.toThrow(
        "Server error",
      );
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValue(new Error("Network failure"));

      const { onSync } = createSyncClient<TestItem>({ endpoint: "/api/sync" });
      const result = await onSync({
        changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
        query: {},
        context: undefined,
        signal: new AbortController().signal,
      });

      expect(result.syncResults[0]).toEqual({ id: "1", status: "error", error: "Network failure" });
    });
  });
});
