import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { useCrud, type Item } from "../useCrud";

interface TestItem extends Item {
  name: string;
  count: number;
}

const initialItems = [
  { id: "1", name: "Item 1", count: 0 },
  { id: "2", name: "Item 2", count: 0 },
];

// MSW server setup
const server = setupServer(
  http.delete("/api/items/:id", ({ params }) => {
    return HttpResponse.json({ id: params.id });
  }),
  http.get("/api/items", () => {
    return HttpResponse.json({ items: initialItems, metadata: {} });
  })
);

// Enable API mocking before tests
beforeAll(() => server.listen());

// Reset any runtime request handlers we may add during the tests
afterEach(() => server.resetHandlers());

// Disable API mocking after the tests are done
afterAll(() => server.close());

describe("useCrud - remove operation", () => {
  const defaultContext = { userId: "123" };

  const setupHook = (options = {}) => {
    return renderHook(() =>
      useCrud<TestItem>({
        id: "test",
        context: defaultContext,
        fetch: async () => ({ items: initialItems, metadata: {} }),
        remove: async (item) => {
          const response = await fetch(`/api/items/${item.id}`, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
          });
          return response.json();
        },
        ...options,
      })
    );
  };

  it("should remove an item successfully", async () => {
    const { result } = setupHook();

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const itemToRemove = result.current.items[0].data;

    await act(async () => {
      result.current.remove(itemToRemove);
    });

    // Verify item is removed
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].data.id).toBe("2");
  });

  it("should handle remove errors", async () => {
    // Override handler for this test to simulate error
    server.use(
      http.delete("/api/items/:id", () => {
        return HttpResponse.error();
      })
    );

    const { result } = setupHook();

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const itemToRemove = result.current.items[0].data;

    await act(async () => {
      result.current.remove(itemToRemove);
    });

    // Verify item is still in the list but with error state
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].state).toBe("delete");
    expect(result.current.items[0].errors).toHaveLength(1);
    expect(result.current.hasError).toBe(true);
  });

  it("should remove without backend call when no remove function provided", async () => {
    const { result } = setupHook({ remove: undefined });

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const itemToRemove = result.current.items[0].data;

    await act(async () => {
      result.current.remove(itemToRemove);
    });

    // Verify item is removed immediately without backend call
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].data.id).toBe("2");
    expect(result.current.items[0].state).toBe("idle");
  });

  it("should maintain other items' states during remove", async () => {
    const { result } = setupHook();

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const itemToRemove = result.current.items[0].data;
    const otherItem = result.current.items[1].data;

    await act(async () => {
      result.current.remove(itemToRemove);
    });

    // Verify other item remained unchanged
    expect(result.current.items).toHaveLength(1);
    const remainingItem = result.current.items[0];
    expect(remainingItem.data).toEqual(otherItem);
    expect(remainingItem.state).toBe("idle");
  });

  it("should invalidate cache for current context after remove", async () => {
    let fetchCount = 0;
    const mockItemsPage1 = [...initialItems];
    const mockItemsPage2 = initialItems.map((item) => ({
      ...item,
      id: `page2_${item.id}`,
      name: `Page 2 ${item.name}`,
    }));

    const mockFetch = async ({ context }) => {
      fetchCount++;
      return {
        items: context.page === 1 ? mockItemsPage1 : mockItemsPage2,
        metadata: { page: context.page },
      };
    };

    const contexts = {
      page1: { page: 1 },
      page2: { page: 2 },
    };

    const { result, rerender } = renderHook(
      ({ context }) =>
        useCrud<TestItem>({
          id: "test-cache",
          context,
          fetch: mockFetch,
          remove: async (item) => {
            // Simulate successful remove only in the page where it was removed
            if (item.id.startsWith("page2_")) {
              const index = mockItemsPage2.findIndex((i) => i.id === item.id);
              if (index !== -1) mockItemsPage2.splice(index, 1);
            } else {
              const index = mockItemsPage1.findIndex((i) => i.id === item.id);
              if (index !== -1) mockItemsPage1.splice(index, 1);
            }
            return { id: item.id };
          },
          caching: {
            capacity: 2, // Enough for both pages
            age: 1000,
          },
        }),
      {
        initialProps: { context: contexts.page1 },
      }
    );

    // Initial load of page 1
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
    expect(fetchCount).toBe(1);

    // Load page 2
    rerender({ context: contexts.page2 });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
      expect(result.current.items[0].data.id).toBe("page2_1");
    });
    expect(fetchCount).toBe(2);

    // Back to page 1 (should use cache)
    rerender({ context: contexts.page1 });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
    expect(fetchCount).toBe(2); // Using cache

    // Remove an item from page 1
    const itemToRemove = result.current.items[0].data;
    await act(async () => {
      result.current.remove(itemToRemove);
    });

    // Verify item is removed from page 1
    expect(result.current.items).toHaveLength(1);

    // Switch to page 2 (should use cache since it wasn't affected by the remove)
    rerender({ context: contexts.page2 });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
    expect(fetchCount).toBe(2); // Still using cache for page 2

    // Back to page 1 (should fetch fresh since its cache was invalidated)
    rerender({ context: contexts.page1 });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(fetchCount).toBe(3); // Fresh fetch for page 1 only
  });
});
