import { useCrud } from "../useCrud";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";

const mockItems = [
  { id: "1", name: "Item 1" },
  { id: "2", name: "Item 2" },
];

const mockMetadata = {
  total: 2,
  page: 1,
};

// MSW server setup
const server = setupServer(
  http.get("/api/items", () => {
    return HttpResponse.json({ items: mockItems, metadata: mockMetadata });
  })
);

// Enable API mocking before tests
beforeAll(() => server.listen());

// Reset any runtime request handlers we may add during the tests
afterEach(() => server.resetHandlers());

// Disable API mocking after the tests are done
afterAll(() => server.close());

describe("useCrud - fetch operations", () => {
  const defaultConfig = {
    id: "test-crud",
    context: {},
    fetch: async ({ signal }) => {
      const response = await fetch("/api/items", { signal });
      return response.json();
    },
  };

  it("should fetch items and update state", async () => {
    const { result } = renderHook(() => useCrud(defaultConfig));

    // Initial state
    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toHaveLength(0);

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.metadata).toEqual(mockMetadata);
    expect(result.current.hasError).toBe(false);
    expect(result.current.errors).toHaveLength(0);

    // Verify item structure
    const firstItem = result.current.items[0];
    expect(firstItem.data).toEqual(mockItems[0]);
    expect(firstItem.state).toBe("idle");
    expect(firstItem.optimistic).toBe(false);
    expect(firstItem.errors).toHaveLength(0);
  });

  it("should handle fetch errors", async () => {
    // Override the default handler for this test
    server.use(
      http.get("/api/items", () => {
        return HttpResponse.error();
      })
    );

    const { result } = renderHook(() => useCrud(defaultConfig));

    // Initial state
    expect(result.current.isLoading).toBe(true);

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.hasError).toBe(true);
    expect(result.current.errors).toHaveLength(1);
  });

  it("should refetch when context changes", async () => {
    let fetchCount = 0;
    const config = {
      ...defaultConfig,
      fetch: async ({ signal }) => {
        fetchCount++;
        const response = await fetch("/api/items", { signal });
        return response.json();
      },
    };

    const { rerender } = renderHook(
      (context) =>
        useCrud({
          ...config,
          context,
        }),
      {
        initialProps: { page: 1 },
      }
    );

    // Wait for initial fetch
    await waitFor(() => {
      expect(fetchCount).toBe(1);
    });

    // Change context
    rerender({ page: 2 });

    // Wait for refetch
    await waitFor(() => {
      expect(fetchCount).toBe(2);
    });
  });

  it("should cache results when caching is enabled", async () => {
    let fetchCount = 0;
    const config = {
      ...defaultConfig,
      caching: {
        capacity: 1,
        age: 1000,
      },
      fetch: async ({ signal }) => {
        fetchCount++;
        const response = await fetch("/api/items", { signal });
        return response.json();
      },
    };

    // First render
    const { rerender } = renderHook(
      (id) =>
        useCrud({
          ...config,
          id,
        }),
      {
        initialProps: "test-1",
      }
    );

    // Wait for initial fetch
    await waitFor(() => {
      expect(fetchCount).toBe(1);
    });

    // Rerender with same ID (should use cache)
    rerender("test-1");

    // Verify no additional fetch was made
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetchCount).toBe(1);
  });

  it("should debounce fetch requests", async () => {
    let fetchCount = 0;
    const config = {
      ...defaultConfig,
      debounce: 300,
      fetch: async ({ signal }) => {
        console.log("Called");
        fetchCount++;
        const response = await fetch("/api/items", { signal });
        return response.json();
      },
    };

    const { result, rerender } = renderHook((context) => useCrud({ ...config, context }), {
      initialProps: { page: 1 },
    });

    // Trigger multiple rerenders in quick succession
    rerender({ page: 2 });
    rerender({ page: 3 });
    rerender({ page: 4 });

    // Wait for debounce
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should only have made one fetch request
    expect(fetchCount).toBe(1);
  });
});
