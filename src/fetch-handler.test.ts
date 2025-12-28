import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import { FetchHandler, type FetchHandlerConfig } from "./fetch-handler";

interface TestItem {
  id: string;
  name: string;
}

interface TestContext {
  page: number;
  limit: number;
  search?: string;
}

const mockItems: TestItem[] = [
  { id: "1", name: "Item 1" },
  { id: "2", name: "Item 2" },
  { id: "3", name: "Item 3" },
];

const server = setupServer(
  http.get("/api/items", async ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 10);
    const search = url.searchParams.get("search");

    let items = [...mockItems];
    if (search) {
      items = items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
    }

    const start = (page - 1) * limit;
    const paginatedItems = items.slice(start, start + limit);

    return HttpResponse.json(paginatedItems);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("FetchHandler", () => {
  let fetchHandler: FetchHandler<TestItem, TestContext>;

  const createFetchHandler = (
    overrides?: Partial<FetchHandlerConfig<TestItem, TestContext>>,
  ): FetchHandler<TestItem, TestContext> => {
    return new FetchHandler<TestItem, TestContext>({
      id: "test-items",
      cacheCapacity: 5,
      cacheTtl: 5000,
      onFetch: async (context, signal) => {
        const params = new URLSearchParams({
          page: String(context.page),
          limit: String(context.limit),
        });
        if (context.search) params.append("search", context.search);

        const response = await fetch(`/api/items?${params}`, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      },
      ...overrides,
    });
  };

  beforeEach(() => {
    server.resetHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic Fetching", () => {
    it("should fetch items successfully", async () => {
      fetchHandler = createFetchHandler();

      const result = await fetchHandler.fetch({ page: 1, limit: 10 });

      expect(result).toEqual(mockItems);
      expect(fetchHandler.getState().status).toBe("idle");
      expect(fetchHandler.getState().items).toEqual(mockItems);
      expect(fetchHandler.getState().error).toBeUndefined();
    });

    it("should set status to fetching during request", async () => {
      server.use(
        http.get("/api/items", async () => {
          await delay(100);
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler();
      const fetchPromise = fetchHandler.fetch({ page: 1, limit: 10 });

      expect(fetchHandler.getState().status).toBe("fetching");
      expect(fetchHandler.isFetching()).toBe(true);

      await fetchPromise;

      expect(fetchHandler.getState().status).toBe("idle");
      expect(fetchHandler.isFetching()).toBe(false);
    });

    it("should update context after fetch", async () => {
      fetchHandler = createFetchHandler();

      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(fetchHandler.getContext()).toEqual({ page: 1, limit: 10 });

      await fetchHandler.fetch({ page: 2, limit: 5 });
      expect(fetchHandler.getContext()).toEqual({ page: 2, limit: 5 });
    });

    it("should handle search parameter in context", async () => {
      fetchHandler = createFetchHandler();

      const result = await fetchHandler.fetch({ page: 1, limit: 10, search: "Item 1" });

      expect(result).toEqual([{ id: "1", name: "Item 1" }]);
    });
  });

  describe("Error Handling", () => {
    it("should set error state on fetch failure", async () => {
      server.use(
        http.get("/api/items", () => {
          return HttpResponse.json({ error: "Server error" }, { status: 500 });
        }),
      );

      fetchHandler = createFetchHandler();

      await expect(fetchHandler.fetch({ page: 1, limit: 10 })).rejects.toThrow("HTTP 500");

      expect(fetchHandler.getState().status).toBe("error");
      expect(fetchHandler.getState().error).toBe("HTTP 500");
    });

    it("should set error state on network failure", async () => {
      server.use(
        http.get("/api/items", () => {
          return HttpResponse.error();
        }),
      );

      fetchHandler = createFetchHandler();

      await expect(fetchHandler.fetch({ page: 1, limit: 10 })).rejects.toThrow();

      expect(fetchHandler.getState().status).toBe("error");
      expect(fetchHandler.getState().error).toBeDefined();
    });

    it("should preserve previous items on error", async () => {
      fetchHandler = createFetchHandler();

      // First successful fetch
      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(fetchHandler.getState().items).toEqual(mockItems);

      // Setup error for next request
      server.use(
        http.get("/api/items", () => {
          return HttpResponse.json({ error: "Server error" }, { status: 500 });
        }),
      );

      // Invalidate cache to force new fetch
      fetchHandler.invalidateCache();

      // Second fetch fails
      await expect(fetchHandler.fetch({ page: 1, limit: 10 })).rejects.toThrow();

      // Items should still be from successful fetch
      expect(fetchHandler.getState().items).toEqual(mockItems);
    });
  });

  describe("Caching", () => {
    it("should return cached results for same context", async () => {
      let fetchCount = 0;
      server.use(
        http.get("/api/items", () => {
          fetchCount++;
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler();

      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(fetchCount).toBe(1);

      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(fetchCount).toBe(1); // Should use cache
    });

    it("should fetch again for different context", async () => {
      let fetchCount = 0;
      server.use(
        http.get("/api/items", () => {
          fetchCount++;
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler();

      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(fetchCount).toBe(1);

      await fetchHandler.fetch({ page: 2, limit: 10 });
      expect(fetchCount).toBe(2);
    });

    it("should invalidate all cache with invalidateCache()", async () => {
      let fetchCount = 0;
      server.use(
        http.get("/api/items", () => {
          fetchCount++;
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler();

      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(fetchCount).toBe(1);

      fetchHandler.invalidateCache();

      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(fetchCount).toBe(2);
    });

    it("should invalidate specific context cache", async () => {
      let fetchCount = 0;
      server.use(
        http.get("/api/items", () => {
          fetchCount++;
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler();

      await fetchHandler.fetch({ page: 1, limit: 10 });
      await fetchHandler.fetch({ page: 2, limit: 10 });
      expect(fetchCount).toBe(2);

      // Invalidate only page 1
      fetchHandler.invalidateCacheForContext({ page: 1, limit: 10 });

      // Page 1 should refetch
      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(fetchCount).toBe(3);

      // Page 2 should still be cached
      await fetchHandler.fetch({ page: 2, limit: 10 });
      expect(fetchCount).toBe(3);
    });

    it("should respect cache TTL", async () => {
      vi.useFakeTimers();

      let fetchCount = 0;
      server.use(
        http.get("/api/items", () => {
          fetchCount++;
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler({ cacheTtl: 1000 });

      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(fetchCount).toBe(1);

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(fetchCount).toBe(2);

      vi.useRealTimers();
    });
  });

  describe("Refresh", () => {
    it("should bypass cache and refetch", async () => {
      let fetchCount = 0;
      server.use(
        http.get("/api/items", () => {
          fetchCount++;
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler();

      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(fetchCount).toBe(1);

      await fetchHandler.refresh();
      expect(fetchCount).toBe(2);
    });

    it("should refresh with provided context", async () => {
      let lastPage: number | null = null;
      server.use(
        http.get("/api/items", ({ request }) => {
          const url = new URL(request.url);
          lastPage = Number(url.searchParams.get("page"));
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler();

      await fetchHandler.fetch({ page: 1, limit: 10 });
      expect(lastPage).toBe(1);

      await fetchHandler.refresh({ page: 3, limit: 10 });
      expect(lastPage).toBe(3);
    });

    it("should throw if no context available for refresh", async () => {
      fetchHandler = createFetchHandler();

      await expect(fetchHandler.refresh()).rejects.toThrow("No context provided for refresh");
    });
  });

  describe("Request Abortion", () => {
    it("should abort previous request when new fetch starts", async () => {
      server.use(
        http.get("/api/items", async () => {
          await delay(200);
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler();

      // Start first fetch
      const firstFetch = fetchHandler.fetch({ page: 1, limit: 10 });

      // Start second fetch before first completes (this aborts the first)
      const secondFetch = fetchHandler.fetch({ page: 2, limit: 10 });

      // First fetch returns current items (aborted silently), second succeeds
      const [firstResult, secondResult] = await Promise.all([firstFetch, secondFetch]);

      // First fetch should return current items (empty initially, then aborted)
      expect(firstResult).toEqual([]);

      // Second fetch should complete successfully
      expect(secondResult).toEqual(mockItems);
    });

    it("should not update state after abort", async () => {
      server.use(
        http.get("/api/items", async ({ request }) => {
          const url = new URL(request.url);
          const page = url.searchParams.get("page");
          await delay(page === "1" ? 200 : 50);
          return HttpResponse.json(page === "1" ? [{ id: "old", name: "Old" }] : mockItems);
        }),
      );

      fetchHandler = createFetchHandler();

      // Start slow fetch
      const firstFetch = fetchHandler.fetch({ page: 1, limit: 10 });

      // Start fast fetch (should abort first)
      const secondFetch = fetchHandler.fetch({ page: 2, limit: 10 });

      await Promise.all([firstFetch, secondFetch]);

      // Final state should reflect second fetch
      expect(fetchHandler.getState().items).toEqual(mockItems);
    });
  });

  describe("Retry Logic", () => {
    it("should retry on failure when retries > 0", async () => {
      let attemptCount = 0;
      server.use(
        http.get("/api/items", () => {
          attemptCount++;
          if (attemptCount < 3) {
            return HttpResponse.json({ error: "Temporary error" }, { status: 500 });
          }
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler({ retries: 3 });

      const result = await fetchHandler.fetch({ page: 1, limit: 10 });

      expect(attemptCount).toBe(3);
      expect(result).toEqual(mockItems);
      expect(fetchHandler.getState().status).toBe("idle");
    });

    it("should fail after exhausting retries", async () => {
      let attemptCount = 0;
      server.use(
        http.get("/api/items", () => {
          attemptCount++;
          return HttpResponse.json({ error: "Persistent error" }, { status: 500 });
        }),
      );

      fetchHandler = createFetchHandler({ retries: 2 });

      await expect(fetchHandler.fetch({ page: 1, limit: 10 })).rejects.toThrow("HTTP 500");

      // Initial attempt + 2 retries = 3 total
      expect(attemptCount).toBe(3);
      expect(fetchHandler.getState().status).toBe("error");
    });

    it("should update retryCount during retries", async () => {
      const retryCountHistory: (number | undefined)[] = [];

      server.use(
        http.get("/api/items", async () => {
          await delay(10);
          return HttpResponse.json({ error: "Error" }, { status: 500 });
        }),
      );

      fetchHandler = createFetchHandler({ retries: 2 });
      fetchHandler.subscribe(() => {
        retryCountHistory.push(fetchHandler.getState().retryCount);
      });

      await expect(fetchHandler.fetch({ page: 1, limit: 10 })).rejects.toThrow();

      // Should have recorded retry counts
      expect(retryCountHistory).toContain(1);
      expect(retryCountHistory).toContain(2);
    });

    it("should not retry when retries is 0 (default)", async () => {
      let attemptCount = 0;
      server.use(
        http.get("/api/items", () => {
          attemptCount++;
          return HttpResponse.json({ error: "Error" }, { status: 500 });
        }),
      );

      fetchHandler = createFetchHandler(); // Default retries: 0

      await expect(fetchHandler.fetch({ page: 1, limit: 10 })).rejects.toThrow();

      expect(attemptCount).toBe(1);
    });

    it("should stop retrying if aborted", async () => {
      let attemptCount = 0;
      server.use(
        http.get("/api/items", async ({ request }) => {
          attemptCount++;
          const url = new URL(request.url);
          const page = url.searchParams.get("page");
          await delay(50);
          // Page 1 always fails, page 2 succeeds
          if (page === "1") {
            return HttpResponse.json({ error: "Error" }, { status: 500 });
          }
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler({ retries: 5 });

      // Start fetch with retries (page 1 will keep failing)
      const fetchPromise = fetchHandler.fetch({ page: 1, limit: 10 });

      // Wait for a couple retry attempts
      await delay(150);

      // Start new fetch to abort the first one (page 2 succeeds)
      const secondFetch = fetchHandler.fetch({ page: 2, limit: 10 });

      // First fetch returns current items when aborted, second succeeds
      await Promise.all([fetchPromise, secondFetch]);

      // Should not have completed all 6 retries for page 1 (initial + 5 retries)
      // because it got aborted. Total attempts should be less than 6 + 1 (for page 2)
      expect(attemptCount).toBeLessThan(7);
      expect(fetchHandler.getState().items).toEqual(mockItems);
    });

    it("should clear retryCount on successful fetch", async () => {
      let attemptCount = 0;
      server.use(
        http.get("/api/items", () => {
          attemptCount++;
          if (attemptCount < 2) {
            return HttpResponse.json({ error: "Error" }, { status: 500 });
          }
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler({ retries: 3 });

      await fetchHandler.fetch({ page: 1, limit: 10 });

      expect(fetchHandler.getState().retryCount).toBeUndefined();
      expect(fetchHandler.getState().status).toBe("idle");
    });
  });

  describe("Subscription", () => {
    it("should notify subscribers on state changes", async () => {
      const callback = vi.fn();

      server.use(
        http.get("/api/items", async () => {
          await delay(10);
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler();
      fetchHandler.subscribe(callback);

      await fetchHandler.fetch({ page: 1, limit: 10 });

      // Should be called for: fetching state, then idle state
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it("should allow unsubscribing", async () => {
      const callback = vi.fn();

      fetchHandler = createFetchHandler();
      const unsubscribe = fetchHandler.subscribe(callback);

      unsubscribe();

      await fetchHandler.fetch({ page: 1, limit: 10 });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should support multiple subscribers", async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      fetchHandler = createFetchHandler();
      fetchHandler.subscribe(callback1);
      fetchHandler.subscribe(callback2);

      await fetchHandler.fetch({ page: 1, limit: 10 });

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe("State Immutability", () => {
    it("should return new state reference on changes", async () => {
      fetchHandler = createFetchHandler();

      const state1 = fetchHandler.getState();
      await fetchHandler.fetch({ page: 1, limit: 10 });
      const state2 = fetchHandler.getState();

      expect(state1).not.toBe(state2);
    });

    it("should return same state reference when unchanged", async () => {
      fetchHandler = createFetchHandler();

      await fetchHandler.fetch({ page: 1, limit: 10 });
      const state1 = fetchHandler.getState();

      // Fetch same context (cached)
      await fetchHandler.fetch({ page: 1, limit: 10 });
      const state2 = fetchHandler.getState();

      // State updates even on cache hit due to status change
      // But items reference should be same
      expect(state1.items).toBe(state2.items);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty response", async () => {
      server.use(
        http.get("/api/items", () => {
          return HttpResponse.json([]);
        }),
      );

      fetchHandler = createFetchHandler();
      const result = await fetchHandler.fetch({ page: 1, limit: 10 });

      expect(result).toEqual([]);
      expect(fetchHandler.getState().items).toEqual([]);
    });

    it("should handle concurrent fetches for different contexts", async () => {
      server.use(
        http.get("/api/items", async ({ request }) => {
          const url = new URL(request.url);
          const page = Number(url.searchParams.get("page"));
          await delay(page === 1 ? 100 : 50);
          return HttpResponse.json([{ id: String(page), name: `Page ${page}` }]);
        }),
      );

      fetchHandler = createFetchHandler();

      // Latest fetch should win, first gets aborted
      const fetch1 = fetchHandler.fetch({ page: 1, limit: 10 });
      const fetch2 = fetchHandler.fetch({ page: 2, limit: 10 });

      await Promise.all([fetch1, fetch2]);

      // State should reflect the last completed fetch (page 2)
      expect(fetchHandler.getState().items).toEqual([{ id: "2", name: "Page 2" }]);
    });

    it("should handle rapid successive fetches", async () => {
      server.use(
        http.get("/api/items", async () => {
          await delay(10);
          return HttpResponse.json(mockItems);
        }),
      );

      fetchHandler = createFetchHandler();

      // Fire multiple fetches rapidly - each aborts the previous
      const fetches = [
        fetchHandler.fetch({ page: 1, limit: 10 }),
        fetchHandler.fetch({ page: 2, limit: 10 }),
        fetchHandler.fetch({ page: 3, limit: 10 }),
        fetchHandler.fetch({ page: 4, limit: 10 }),
      ];

      await Promise.all(fetches);

      // Final context should be from last fetch
      expect(fetchHandler.getContext()).toEqual({ page: 4, limit: 10 });
    });

    it("should generate unique cache keys for different IDs", async () => {
      let fetchCount1 = 0;
      let fetchCount2 = 0;

      const handler1 = new FetchHandler<TestItem, TestContext>({
        id: "handler-1",
        cacheCapacity: 5,
        cacheTtl: 5000,
        onFetch: async () => {
          fetchCount1++;
          return mockItems;
        },
      });

      const handler2 = new FetchHandler<TestItem, TestContext>({
        id: "handler-2",
        cacheCapacity: 5,
        cacheTtl: 5000,
        onFetch: async () => {
          fetchCount2++;
          return mockItems;
        },
      });

      // Same context, different handlers
      await handler1.fetch({ page: 1, limit: 10 });
      await handler2.fetch({ page: 1, limit: 10 });

      expect(fetchCount1).toBe(1);
      expect(fetchCount2).toBe(1);
    });
  });
});
