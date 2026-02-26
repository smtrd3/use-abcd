import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSyncClient } from "./client";
import type { Result } from "../types";

interface TestItem {
  id: string;
  name: string;
}

describe("createSyncClient", () => {
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
    const syncResults: Record<string, Result> = {
      "1": { status: "success" },
      "2": { status: "success" },
    };
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ syncResults }), { status: 200 }));

    const handler = createSyncClient<TestItem>("/api/sync");
    const signal = new AbortController().signal;

    const result = await handler(
      {
        changes: [
          { id: "1", type: "create", data: { id: "1", name: "New" } },
          { id: "2", type: "update", data: { id: "2", name: "Updated" } },
        ],
      },
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
    expect(result).toEqual({ syncResults });
  });

  it("accepts string endpoint config", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ syncResults: {} }), { status: 200 }),
    );

    const handler = createSyncClient<TestItem>("/api/items/sync");
    await handler({ changes: [] }, new AbortController().signal);

    expect(mockFetch).toHaveBeenCalledWith("/api/items/sync", expect.any(Object));
  });

  it("accepts object config with custom headers", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ syncResults: {} }), { status: 200 }),
    );

    const handler = createSyncClient<TestItem>({
      endpoint: "/api/sync",
      headers: { Authorization: "Bearer token123" },
    });
    await handler({ changes: [] }, new AbortController().signal);

    expect(mockFetch).toHaveBeenCalledWith("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token123" },
      body: expect.any(String),
      signal: expect.any(Object),
    });
  });

  it("throws error when response is not ok", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Server error" }), { status: 500 }),
    );

    const handler = createSyncClient<TestItem>("/api/sync");
    const signal = new AbortController().signal;

    await expect(
      handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "New" } },
            { id: "2", type: "update", data: { id: "2", name: "Updated" } },
          ],
        },
        signal,
      ),
    ).rejects.toThrow("Server error");
  });

  it("throws default error when response has no error field", async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 500 }));

    const handler = createSyncClient<TestItem>("/api/sync");

    await expect(
      handler(
        {
          changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Request failed");
  });

  it("handles network errors", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const handler = createSyncClient<TestItem>("/api/sync");

    await expect(
      handler(
        {
          changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Network failure");
  });

  it("handles abort errors", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValue(abortError);

    const handler = createSyncClient<TestItem>("/api/sync");

    await expect(
      handler(
        {
          changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it("handles non-Error exceptions", async () => {
    mockFetch.mockRejectedValue("string error");

    const handler = createSyncClient<TestItem>("/api/sync");

    await expect(
      handler(
        {
          changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it("throws when already aborted", async () => {
    const handler = createSyncClient<TestItem>("/api/sync");
    const controller = new AbortController();
    controller.abort();

    await expect(
      handler(
        { changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }] },
        controller.signal,
      ),
    ).rejects.toThrow("Operation aborted");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe("fetch (query)", () => {
    it("sends query to endpoint and returns results", async () => {
      const items = [
        { id: "1", name: "Item 1" },
        { id: "2", name: "Item 2" },
      ];
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ results: items }), { status: 200 }),
      );

      const handler = createSyncClient<TestItem, { page: number }>("/api/sync");
      const signal = new AbortController().signal;

      const result = await handler({ query: { page: 1 } }, signal);

      expect(mockFetch).toHaveBeenCalledWith("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: { page: 1 } }),
        signal,
      });
      expect(result).toEqual({ results: items });
    });

    it("returns empty object when results is missing from response", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

      const handler = createSyncClient<TestItem, { page: number }>("/api/sync");
      const result = await handler({ query: { page: 1 } }, new AbortController().signal);

      expect(result).toEqual({});
    });

    it("throws error when response is not ok", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Server error" }), { status: 500 }),
      );

      const handler = createSyncClient<TestItem, { page: number }>("/api/sync");

      await expect(
        handler({ query: { page: 1 } }, new AbortController().signal),
      ).rejects.toThrow("Server error");
    });

    it("throws default error when response has no error field", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 500 }));

      const handler = createSyncClient<TestItem, { page: number }>("/api/sync");

      await expect(
        handler({ query: { page: 1 } }, new AbortController().signal),
      ).rejects.toThrow("Request failed");
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValue(new Error("Network failure"));

      const handler = createSyncClient<TestItem, { page: number }>("/api/sync");

      await expect(
        handler({ query: { page: 1 } }, new AbortController().signal),
      ).rejects.toThrow("Network failure");
    });

    it("handles abort errors", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValue(abortError);

      const handler = createSyncClient<TestItem, { page: number }>("/api/sync");

      await expect(
        handler({ query: { page: 1 } }, new AbortController().signal),
      ).rejects.toThrow();
    });

    it("uses custom headers", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));

      const handler = createSyncClient<TestItem, { page: number }>({
        endpoint: "/api/sync",
        headers: { Authorization: "Bearer token123" },
      });
      await handler({ query: { page: 1 } }, new AbortController().signal);

      expect(mockFetch).toHaveBeenCalledWith("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer token123" },
        body: expect.any(String),
        signal: expect.any(Object),
      });
    });
  });
});
