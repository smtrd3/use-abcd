import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { useCrud, useItemState, type Item, type ItemWithState } from "../useCrud";

interface TestItem extends Item {
  name: string;
  count: number;
}

// MSW server setup
const server = setupServer(
  http.patch("/api/items/:id", async ({ request, params }) => {
    const body = (await request.json()) as Partial<TestItem>;
    return HttpResponse.json({ id: params.id as string, ...body });
  })
);

// Enable API mocking before tests
beforeAll(() => server.listen());

// Reset any runtime request handlers we may add during the tests
afterEach(() => server.resetHandlers());

// Disable API mocking after the tests are done
afterAll(() => server.close());

describe("useCrud - update operation", () => {
  const defaultContext = { userId: "123" };
  const initialItems = [
    { id: "1", name: "Item 1", count: 0 },
    { id: "2", name: "Item 2", count: 0 },
  ];

  const setupCrudHook = (options = {}) => {
    return renderHook(() => {
      return useCrud<TestItem>({
        id: "test",
        context: defaultContext,
        fetch: async () => ({ items: initialItems, metadata: {} }),
        update: async (item, { signal }) => {
          const response = await fetch(`/api/items/${item.id}`, {
            method: "PATCH",
            body: JSON.stringify(item),
            signal,
            headers: {
              "Content-Type": "application/json",
            },
          });
          return response.json();
        },
        ...options,
      });
    });
  };

  const setupItemHook = (item: ItemWithState<TestItem>) => {
    return renderHook(
      ({ item }) => {
        return useItemState("test", item as ItemWithState<TestItem>);
      },
      { initialProps: { item } }
    );
  };

  it("should update an item without optimistic updates", async () => {
    const { result } = setupCrudHook();

    await waitFor(() => {
      expect(result.current.items.length).toBeGreaterThan(0);
    });

    const itemHook = setupItemHook(result.current.items[0]);
    const itemResult = itemHook.result;
    const [, { update }] = itemResult.current;

    await act(async () => {
      update(
        (draft) => {
          draft.name = "Updated Item 1";
          draft.count = 1;
        },
        { isOptimistic: false }
      );
    });

    // Rerender the item hook with the latest item reference
    itemHook.rerender({ item: result.current.items[0] });

    await waitFor(() => {
      expect(result.current.items[0].data).toEqual({
        id: "1",
        name: "Updated Item 1",
        count: 1,
      });
      expect(result.current.items[0].transitions.size).toBe(0);
    });
  });

  it("should handle update with optimistic updates", async () => {
    const { result } = setupCrudHook({ isOptimistic: true });

    await waitFor(() => {
      expect(result.current.items.length).toBeGreaterThan(0);
    });

    const itemHook = setupItemHook(result.current.items.at(0));
    const itemResult = itemHook.result;
    const [, { update }] = itemResult.current;

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    act(() => {
      update(
        (draft) => {
          draft.name = "Optimistically Updated";
          draft.count = 2;
        },
        { isOptimistic: true }
      );
    });

    itemHook.rerender({ item: result.current.items[0] });

    // Check immediate optimistic update
    expect(itemResult.current[0]).toEqual({
      id: "1",
      name: "Optimistically Updated",
      count: 2,
    });
    expect(result.current.items[0].transitions.get("default").at(0)).toBe("update");
    expect(result.current.items[0].optimistic).toBe(true);

    // Wait for backend update to complete
    await waitFor(() => {
      expect(result.current.items[0].transitions.size).toBe(0);
    });

    expect(result.current.items[0].optimistic).toBe(false);
  });

  it("should handle update errors", async () => {
    // Override handler for this test to simulate error
    server.use(
      http.patch("/api/items/:id", () => {
        return HttpResponse.error();
      })
    );

    const { result } = setupCrudHook({ isOptimistic: true });

    await waitFor(() => {
      expect(result.current.items.length).toBeGreaterThan(0);
    });

    const itemHook = setupItemHook(result.current.items.at(0));
    const itemResult = itemHook.result;
    const [, { update }] = itemResult.current;

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    await act(async () => {
      update((draft) => {
        draft.name = "Will Fail";
      });
    });

    itemHook.rerender({ item: result.current.items[0] });

    expect(itemResult.current[1].itemWithState.transitions.get("default").at(0)).toBe("update");
    expect(itemResult.current[1].itemWithState.errors).toHaveLength(1);
    expect(result.current.hasError).toBe(true);
  });

  it("should update without backend call when no update function provided", async () => {
    const { result } = setupCrudHook();

    await waitFor(() => {
      expect(result.current.items.length).toBeGreaterThan(0);
    });

    const itemHook = setupItemHook(result.current.items[0]);
    const itemResult = itemHook.result;

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    await act(async () => {
      itemResult.current[1].change((draft) => {
        draft.name = "Local Update";
      });
    });

    itemHook.rerender({ item: result.current.items[0] });

    expect(itemResult.current[0].name).toBe("Local Update");
    expect(itemResult.current[1].itemWithState.transitions.get("default").at(0)).toBe("changed");
  });

  it("should handle cancellation of update operation", async () => {
    // Setup a delayed response
    server.use(
      http.patch("/api/items/:id", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return HttpResponse.json({ id: "1", name: "Delayed Update" });
      })
    );

    const { result } = setupCrudHook();

    await waitFor(() => {
      expect(result.current.items.length).toBeGreaterThan(0);
    });

    const originalItem = result.current.items[0].data;
    const itemHook = setupItemHook(result.current.items.at(0));
    const itemResult = itemHook.result;

    // Start update with optimistic update
    act(() => {
      itemResult.current[1].update((draft) => {
        draft.name = "Will Be Cancelled";
      });
    });

    itemHook.rerender({ item: result.current.items[0] });

    expect(itemResult.current[1].itemWithState.transitions.get("default").at(0)).toBe("update");

    act(() => {
      result.current.cancelOperation(result.current.items[0].data.id);
    });

    itemHook.rerender({ item: result.current.items[0] });

    await waitFor(() => {
      expect(itemResult.current[0]).toEqual(originalItem);
      expect(result.current.items[0].transitions.size).toBe(0);
    });
  });

  it("should maintain other items' states during update", async () => {
    const { result } = setupCrudHook();

    await waitFor(() => {
      expect(result.current.items.length).toBeGreaterThan(0);
    });

    const itemHook = setupItemHook(result.current.items.at(0));
    const itemResult = itemHook.result;

    const otherItem = result.current.items[1];

    await act(async () => {
      itemResult.current[1].update((draft) => {
        draft.name = "Updated Item";
      });
    });

    // Rerender the item hook with the latest item reference
    itemHook.rerender({ item: result.current.items[0] });

    await waitFor(() => {
      expect(itemResult.current[0].name).toBe("Updated Item");
    });

    // Check that other item remained unchanged
    const unchangedItem = result.current.items.find((item) => item.data.id === otherItem.data.id);
    expect(unchangedItem?.data).toEqual(otherItem.data);
    // Check if the other item has no ongoing transitions (is in idle state)
    expect(unchangedItem?.transitions.size).toBe(0);
  });
});
