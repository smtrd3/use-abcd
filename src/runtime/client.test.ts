import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSyncClient,
  createSyncClientWithStats,
  createSyncClientFromEndpoint,
  syncSuccess,
  syncError,
  fetchToSyncResult,
  categorizeResults,
} from "./client";
import type { Change } from "../types";

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

    it("categorizeResults categorizes results correctly", () => {
      const results = [
        { id: "1", status: "success" as const },
        { id: "2", status: "error" as const, error: "Failed" },
        { id: "3", status: "success" as const },
      ];

      const categorized = categorizeResults(results);

      expect(categorized.results).toEqual(results);
      expect(categorized.successful).toHaveLength(2);
      expect(categorized.failed).toHaveLength(1);
      expect(categorized.allSucceeded).toBe(false);
      expect(categorized.anySucceeded).toBe(true);
      expect(categorized.summary).toEqual({ total: 3, succeeded: 2, failed: 1 });
    });

    it("categorizeResults handles all success", () => {
      const results = [
        { id: "1", status: "success" as const },
        { id: "2", status: "success" as const },
      ];

      const categorized = categorizeResults(results);

      expect(categorized.allSucceeded).toBe(true);
      expect(categorized.anySucceeded).toBe(true);
    });

    it("categorizeResults handles all failures", () => {
      const results = [
        { id: "1", status: "error" as const, error: "Failed" },
        { id: "2", status: "error" as const, error: "Failed" },
      ];

      const categorized = categorizeResults(results);

      expect(categorized.allSucceeded).toBe(false);
      expect(categorized.anySucceeded).toBe(false);
    });
  });

  describe("createSyncClient", () => {
    describe("Offline-First Support (Missing Handlers)", () => {
      it("returns success when create handler not configured", async () => {
        const { onSync } = createSyncClient<TestItem>({});
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "New Item" } }],
          undefined,
          signal,
        );

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({ id: "temp-1", status: "success" });
      });

      it("returns success when update handler not configured", async () => {
        const { onSync } = createSyncClient<TestItem>({});
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "1", type: "update", data: { id: "1", name: "Updated" } }],
          undefined,
          signal,
        );

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({ id: "1", status: "success" });
      });

      it("returns success when delete handler not configured", async () => {
        const { onSync } = createSyncClient<TestItem>({});
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "1", type: "delete", data: { id: "1", name: "To Delete" } }],
          undefined,
          signal,
        );

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({ id: "1", status: "success" });
      });

      it("works with empty config (full offline mode)", async () => {
        const { onSync } = createSyncClient<TestItem>({});
        const signal = new AbortController().signal;

        const results = await onSync(
          [
            { id: "1", type: "create", data: { id: "1", name: "New" } },
            { id: "2", type: "update", data: { id: "2", name: "Updated" } },
            { id: "3", type: "delete", data: { id: "3", name: "Deleted" } },
          ],
          undefined,
          signal,
        );

        expect(results).toHaveLength(3);
        expect(results.every((r) => r.status === "success")).toBe(true);
      });

      it("uses configured handlers when available", async () => {
        const createFn = vi.fn().mockResolvedValue(syncSuccess({ newId: "server-1" }));
        const { onSync } = createSyncClient<TestItem>({ create: createFn });
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "New" } }],
          undefined,
          signal,
        );

        expect(createFn).toHaveBeenCalledWith({ id: "temp-1", name: "New" }, signal);
        expect(results[0]).toEqual({ id: "temp-1", status: "success", newId: "server-1" });
      });

      it("mixes configured and unconfigured handlers", async () => {
        const updateFn = vi.fn().mockResolvedValue(syncSuccess());
        const { onSync } = createSyncClient<TestItem>({ update: updateFn });
        const signal = new AbortController().signal;

        const results = await onSync(
          [
            { id: "1", type: "create", data: { id: "1", name: "New" } }, // No handler - success
            { id: "2", type: "update", data: { id: "2", name: "Updated" } }, // Has handler
            { id: "3", type: "delete", data: { id: "3", name: "Deleted" } }, // No handler - success
          ],
          undefined,
          signal,
        );

        expect(updateFn).toHaveBeenCalledOnce();
        expect(results[0].status).toBe("success");
        expect(results[1].status).toBe("success");
        expect(results[2].status).toBe("success");
      });
    });

    describe("Create Operations", () => {
      it("processes create change successfully", async () => {
        const { onSync } = createSyncClient<TestItem>({
          create: async (data) => syncSuccess({ newId: `new-${data.name}` }),
        });
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "Item" } }],
          undefined,
          signal,
        );

        expect(results[0]).toEqual({ id: "temp-1", status: "success", newId: "new-Item" });
      });

      it("handles create error", async () => {
        const { onSync } = createSyncClient<TestItem>({
          create: async () => syncError("Duplicate entry"),
        });
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "Item" } }],
          undefined,
          signal,
        );

        expect(results[0]).toEqual({ id: "temp-1", status: "error", error: "Duplicate entry" });
      });

      it("passes signal to create handler", async () => {
        const createFn = vi.fn().mockResolvedValue(syncSuccess());
        const { onSync } = createSyncClient<TestItem>({ create: createFn });
        const controller = new AbortController();

        await onSync(
          [{ id: "1", type: "create", data: { id: "1", name: "Item" } }],
          undefined,
          controller.signal,
        );

        expect(createFn).toHaveBeenCalledWith({ id: "1", name: "Item" }, controller.signal);
      });
    });

    describe("Update Operations", () => {
      it("processes update change successfully", async () => {
        const updateFn = vi.fn().mockResolvedValue(syncSuccess());
        const { onSync } = createSyncClient<TestItem>({ update: updateFn });
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "1", type: "update", data: { id: "1", name: "Updated" } }],
          undefined,
          signal,
        );

        expect(results[0]).toEqual({ id: "1", status: "success" });
        expect(updateFn).toHaveBeenCalledWith("1", { id: "1", name: "Updated" }, signal);
      });

      it("handles update error", async () => {
        const { onSync } = createSyncClient<TestItem>({
          update: async () => syncError("Not found"),
        });
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "1", type: "update", data: { id: "1", name: "Updated" } }],
          undefined,
          signal,
        );

        expect(results[0]).toEqual({ id: "1", status: "error", error: "Not found" });
      });
    });

    describe("Delete Operations", () => {
      it("processes delete change successfully", async () => {
        const deleteFn = vi.fn().mockResolvedValue(syncSuccess());
        const { onSync } = createSyncClient<TestItem>({ delete: deleteFn });
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "1", type: "delete", data: { id: "1", name: "Item" } }],
          undefined,
          signal,
        );

        expect(results[0]).toEqual({ id: "1", status: "success" });
        expect(deleteFn).toHaveBeenCalledWith("1", { id: "1", name: "Item" }, signal);
      });

      it("handles delete error", async () => {
        const { onSync } = createSyncClient<TestItem>({
          delete: async () => syncError("Has dependencies"),
        });
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "1", type: "delete", data: { id: "1", name: "Item" } }],
          undefined,
          signal,
        );

        expect(results[0]).toEqual({ id: "1", status: "error", error: "Has dependencies" });
      });
    });

    describe("Batch Processing", () => {
      it("processes multiple changes in parallel", async () => {
        const order: string[] = [];
        const { onSync } = createSyncClient<TestItem>({
          create: async (data) => {
            await new Promise((r) => setTimeout(r, Math.random() * 10));
            order.push(data.id);
            return syncSuccess({ newId: data.id });
          },
        });
        const signal = new AbortController().signal;

        const results = await onSync(
          [
            { id: "1", type: "create", data: { id: "1", name: "Item 1" } },
            { id: "2", type: "create", data: { id: "2", name: "Item 2" } },
            { id: "3", type: "create", data: { id: "3", name: "Item 3" } },
          ],
          undefined,
          signal,
        );

        expect(results).toHaveLength(3);
        expect(results.every((r) => r.status === "success")).toBe(true);
      });

      it("handles mixed operation types", async () => {
        const { onSync } = createSyncClient<TestItem>({
          create: async () => syncSuccess({ newId: "new-1" }),
          update: async () => syncSuccess(),
          delete: async () => syncSuccess(),
        });
        const signal = new AbortController().signal;

        const results = await onSync(
          [
            { id: "temp-1", type: "create", data: { id: "temp-1", name: "New" } },
            { id: "1", type: "update", data: { id: "1", name: "Updated" } },
            { id: "2", type: "delete", data: { id: "2", name: "Deleted" } },
          ],
          undefined,
          signal,
        );

        expect(results[0].newId).toBe("new-1");
        expect(results.every((r) => r.status === "success")).toBe(true);
      });

      it("continues processing after individual failures", async () => {
        const { onSync } = createSyncClient<TestItem>({
          create: async (data) =>
            data.name === "fail" ? syncError("Failed") : syncSuccess({ newId: data.id }),
        });
        const signal = new AbortController().signal;

        const results = await onSync(
          [
            { id: "1", type: "create", data: { id: "1", name: "success" } },
            { id: "2", type: "create", data: { id: "2", name: "fail" } },
            { id: "3", type: "create", data: { id: "3", name: "success" } },
          ],
          undefined,
          signal,
        );

        expect(results[0].status).toBe("success");
        expect(results[1].status).toBe("error");
        expect(results[2].status).toBe("success");
      });

      it("handles unknown change types", async () => {
        const { onSync } = createSyncClient<TestItem>({});
        const signal = new AbortController().signal;

        const results = await onSync(
          [
            {
              id: "1",
              type: "unknown" as Change<TestItem>["type"],
              data: { id: "1", name: "Item" },
            },
          ],
          undefined,
          signal,
        );

        expect(results[0]).toEqual({
          id: "1",
          status: "error",
          error: "Unknown change type: unknown",
        });
      });
    });

    describe("Abort Handling", () => {
      it("returns error when already aborted", async () => {
        const { onSync } = createSyncClient<TestItem>({
          create: async () => syncSuccess(),
        });
        const controller = new AbortController();
        controller.abort();

        const results = await onSync(
          [{ id: "1", type: "create", data: { id: "1", name: "Item" } }],
          undefined,
          controller.signal,
        );

        expect(results[0]).toEqual({ id: "1", status: "error", error: "Operation aborted" });
      });
    });

    describe("Error Handling", () => {
      it("catches and returns handler exceptions", async () => {
        const { onSync } = createSyncClient<TestItem>({
          create: async () => {
            throw new Error("Unexpected error");
          },
        });
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "1", type: "create", data: { id: "1", name: "Item" } }],
          undefined,
          signal,
        );

        expect(results[0]).toEqual({ id: "1", status: "error", error: "Unexpected error" });
      });

      it("handles non-Error exceptions", async () => {
        const { onSync } = createSyncClient<TestItem>({
          create: async () => {
            throw "string error";
          },
        });
        const signal = new AbortController().signal;

        const results = await onSync(
          [{ id: "1", type: "create", data: { id: "1", name: "Item" } }],
          undefined,
          signal,
        );

        expect(results[0].error).toBe("Unknown error");
      });
    });

    describe("Handlers Object", () => {
      it("exposes individual handlers", () => {
        const createFn = vi.fn();
        const updateFn = vi.fn();
        const deleteFn = vi.fn();

        const { handlers } = createSyncClient<TestItem>({
          create: createFn,
          update: updateFn,
          delete: deleteFn,
        });

        expect(handlers.create).toBe(createFn);
        expect(handlers.update).toBe(updateFn);
        expect(handlers.delete).toBe(deleteFn);
      });
    });
  });

  describe("createSyncClientWithStats", () => {
    it("returns onSync function", async () => {
      const { onSync } = createSyncClientWithStats<TestItem>({
        create: async () => syncSuccess(),
      });
      const signal = new AbortController().signal;

      const results = await onSync(
        [{ id: "1", type: "create", data: { id: "1", name: "Item" } }],
        undefined,
        signal,
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("success");
    });

    it("returns onSyncWithStats function with categorized results", async () => {
      const { onSyncWithStats } = createSyncClientWithStats<TestItem>({
        create: async (data) => (data.name === "fail" ? syncError("Failed") : syncSuccess()),
      });
      const signal = new AbortController().signal;

      const batchResult = await onSyncWithStats(
        [
          { id: "1", type: "create", data: { id: "1", name: "success" } },
          { id: "2", type: "create", data: { id: "2", name: "fail" } },
        ],
        undefined,
        signal,
      );

      expect(batchResult.results).toHaveLength(2);
      expect(batchResult.successful).toHaveLength(1);
      expect(batchResult.failed).toHaveLength(1);
      expect(batchResult.allSucceeded).toBe(false);
      expect(batchResult.anySucceeded).toBe(true);
      expect(batchResult.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
    });

    it("exposes handlers", () => {
      const createFn = vi.fn();
      const { handlers } = createSyncClientWithStats<TestItem>({ create: createFn });

      expect(handlers.create).toBe(createFn);
    });
  });

  describe("fetchToSyncResult", () => {
    it("returns success for ok response", async () => {
      const mockResponse = new Response(null, { status: 200 });

      const result = await fetchToSyncResult({
        fetch: Promise.resolve(mockResponse),
      });

      expect(result).toEqual({ success: true });
    });

    it("parses response with parseResponse", async () => {
      const mockResponse = new Response(JSON.stringify({ id: "new-123" }), { status: 200 });

      const result = await fetchToSyncResult({
        fetch: Promise.resolve(mockResponse),
        parseResponse: async (response) => {
          const data = await response.json();
          return { newId: data.id };
        },
      });

      expect(result).toEqual({ success: true, newId: "new-123" });
    });

    it("returns error for non-ok response", async () => {
      const mockResponse = new Response(null, { status: 500 });

      const result = await fetchToSyncResult({
        fetch: Promise.resolve(mockResponse),
        parseError: "Server error",
      });

      expect(result).toEqual({ success: false, error: "Server error" });
    });

    it("extracts error message from response body", async () => {
      const mockResponse = new Response(JSON.stringify({ message: "User not found" }), {
        status: 404,
      });

      const result = await fetchToSyncResult({
        fetch: Promise.resolve(mockResponse),
      });

      expect(result).toEqual({ success: false, error: "User not found" });
    });

    it("extracts error from response body error field", async () => {
      const mockResponse = new Response(JSON.stringify({ error: "Invalid data" }), {
        status: 400,
      });

      const result = await fetchToSyncResult({
        fetch: Promise.resolve(mockResponse),
      });

      expect(result).toEqual({ success: false, error: "Invalid data" });
    });

    it("uses parseError callback", async () => {
      const mockResponse = new Response(null, { status: 500 });

      const result = await fetchToSyncResult({
        fetch: Promise.resolve(mockResponse),
        parseError: (error) => `Custom: ${error instanceof Error ? error.message : "error"}`,
      });

      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toContain("Custom:");
      }
    });

    it("handles fetch rejection", async () => {
      const result = await fetchToSyncResult({
        fetch: Promise.reject(new Error("Network error")),
        parseError: "Network failed",
      });

      expect(result).toEqual({ success: false, error: "Network failed" });
    });

    it("handles AbortError specially", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";

      const result = await fetchToSyncResult({
        fetch: Promise.reject(abortError),
      });

      expect(result).toEqual({ success: false, error: "Operation aborted" });
    });

    it("uses default error message when parseError not provided", async () => {
      const mockResponse = new Response(null, { status: 500 });

      const result = await fetchToSyncResult({
        fetch: Promise.resolve(mockResponse),
      });

      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toBe("Request failed");
      }
    });
  });

  describe("createSyncClientFromEndpoint", () => {
    const mockFetch = vi.fn();
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = mockFetch;
      mockFetch.mockReset();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("sends changes to endpoint and returns results", async () => {
      const syncResults = [
        { id: "1", status: "success", newId: "server-1" },
        { id: "2", status: "success" },
      ];
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ syncResults }), { status: 200 }));

      const { onSync } = createSyncClientFromEndpoint<TestItem>("/api/sync");
      const signal = new AbortController().signal;

      const results = await onSync(
        [
          { id: "1", type: "create", data: { id: "1", name: "New" } },
          { id: "2", type: "update", data: { id: "2", name: "Updated" } },
        ],
        undefined,
        signal,
      );

      expect(mockFetch).toHaveBeenCalledWith("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "New" } },
            { id: "2", type: "update", data: { id: "2", name: "Updated" } },
          ],
        }),
        signal,
      });
      expect(results).toEqual(syncResults);
    });

    it("accepts string endpoint config", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ syncResults: [] }), { status: 200 }),
      );

      const { onSync } = createSyncClientFromEndpoint<TestItem>("/api/items/sync");
      await onSync([], undefined, new AbortController().signal);

      expect(mockFetch).toHaveBeenCalledWith("/api/items/sync", expect.any(Object));
    });

    it("accepts object config with custom headers", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ syncResults: [] }), { status: 200 }),
      );

      const { onSync } = createSyncClientFromEndpoint<TestItem>({
        endpoint: "/api/sync",
        headers: { Authorization: "Bearer token123" },
      });
      await onSync([], undefined, new AbortController().signal);

      expect(mockFetch).toHaveBeenCalledWith("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer token123" },
        body: expect.any(String),
        signal: expect.any(Object),
      });
    });

    it("returns error for all changes when response is not ok", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Server error" }), { status: 500 }),
      );

      const { onSync } = createSyncClientFromEndpoint<TestItem>("/api/sync");
      const signal = new AbortController().signal;

      const results = await onSync(
        [
          { id: "1", type: "create", data: { id: "1", name: "New" } },
          { id: "2", type: "update", data: { id: "2", name: "Updated" } },
        ],
        undefined,
        signal,
      );

      expect(results).toEqual([
        { id: "1", status: "error", error: "Server error" },
        { id: "2", status: "error", error: "Server error" },
      ]);
    });

    it("returns default error when response has no error field", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 500 }));

      const { onSync } = createSyncClientFromEndpoint<TestItem>("/api/sync");
      const results = await onSync(
        [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
        undefined,
        new AbortController().signal,
      );

      expect(results[0].error).toBe("Sync request failed");
    });

    it("returns error when syncResults is missing from response", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

      const { onSync } = createSyncClientFromEndpoint<TestItem>("/api/sync");
      const results = await onSync(
        [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
        undefined,
        new AbortController().signal,
      );

      expect(results[0]).toEqual({ id: "1", status: "error", error: "No sync results returned" });
    });

    it("returns error when already aborted", async () => {
      const { onSync } = createSyncClientFromEndpoint<TestItem>("/api/sync");
      const controller = new AbortController();
      controller.abort();

      const results = await onSync(
        [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
        undefined,
        controller.signal,
      );

      expect(results[0]).toEqual({ id: "1", status: "error", error: "Operation aborted" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValue(new Error("Network failure"));

      const { onSync } = createSyncClientFromEndpoint<TestItem>("/api/sync");
      const results = await onSync(
        [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
        undefined,
        new AbortController().signal,
      );

      expect(results[0]).toEqual({ id: "1", status: "error", error: "Network failure" });
    });

    it("handles abort errors specially", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValue(abortError);

      const { onSync } = createSyncClientFromEndpoint<TestItem>("/api/sync");
      const results = await onSync(
        [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
        undefined,
        new AbortController().signal,
      );

      expect(results[0]).toEqual({ id: "1", status: "error", error: "Operation aborted" });
    });

    it("handles non-Error exceptions", async () => {
      mockFetch.mockRejectedValue("string error");

      const { onSync } = createSyncClientFromEndpoint<TestItem>("/api/sync");
      const results = await onSync(
        [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
        undefined,
        new AbortController().signal,
      );

      expect(results[0]).toEqual({ id: "1", status: "error", error: "Unknown error" });
    });

    describe("onFetch", () => {
      it("sends query to endpoint and returns results", async () => {
        const items = [
          { id: "1", name: "Item 1" },
          { id: "2", name: "Item 2" },
        ];
        mockFetch.mockResolvedValue(
          new Response(JSON.stringify({ results: items }), { status: 200 }),
        );

        const { onFetch } = createSyncClientFromEndpoint<TestItem, { page: number }>("/api/sync");
        const signal = new AbortController().signal;

        const result = await onFetch({ page: 1 }, signal);

        expect(mockFetch).toHaveBeenCalledWith("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: { page: 1 } }),
          signal,
        });
        expect(result).toEqual(items);
      });

      it("returns empty array when results is missing from response", async () => {
        mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

        const { onFetch } = createSyncClientFromEndpoint<TestItem, { page: number }>("/api/sync");
        const result = await onFetch({ page: 1 }, new AbortController().signal);

        expect(result).toEqual([]);
      });

      it("throws error when response is not ok", async () => {
        mockFetch.mockResolvedValue(
          new Response(JSON.stringify({ error: "Server error" }), { status: 500 }),
        );

        const { onFetch } = createSyncClientFromEndpoint<TestItem, { page: number }>("/api/sync");

        await expect(onFetch({ page: 1 }, new AbortController().signal)).rejects.toThrow(
          "Server error",
        );
      });

      it("throws default error when response has no error field", async () => {
        mockFetch.mockResolvedValue(new Response(null, { status: 500 }));

        const { onFetch } = createSyncClientFromEndpoint<TestItem, { page: number }>("/api/sync");

        await expect(onFetch({ page: 1 }, new AbortController().signal)).rejects.toThrow(
          "Fetch request failed",
        );
      });

      it("throws when already aborted", async () => {
        const { onFetch } = createSyncClientFromEndpoint<TestItem, { page: number }>("/api/sync");
        const controller = new AbortController();
        controller.abort();

        await expect(onFetch({ page: 1 }, controller.signal)).rejects.toThrow("Operation aborted");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("handles network errors", async () => {
        mockFetch.mockRejectedValue(new Error("Network failure"));

        const { onFetch } = createSyncClientFromEndpoint<TestItem, { page: number }>("/api/sync");

        await expect(onFetch({ page: 1 }, new AbortController().signal)).rejects.toThrow(
          "Network failure",
        );
      });

      it("handles abort errors", async () => {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        mockFetch.mockRejectedValue(abortError);

        const { onFetch } = createSyncClientFromEndpoint<TestItem, { page: number }>("/api/sync");

        await expect(onFetch({ page: 1 }, new AbortController().signal)).rejects.toThrow(
          "Operation aborted",
        );
      });

      it("uses custom headers", async () => {
        mockFetch.mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));

        const { onFetch } = createSyncClientFromEndpoint<TestItem, { page: number }>({
          endpoint: "/api/sync",
          headers: { Authorization: "Bearer token123" },
        });
        await onFetch({ page: 1 }, new AbortController().signal);

        expect(mockFetch).toHaveBeenCalledWith("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer token123" },
          body: expect.any(String),
          signal: expect.any(Object),
        });
      });
    });
  });
});
