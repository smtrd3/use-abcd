import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { useCrud, type Item } from "../useCrud";

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

  const setupHook = (options = {}) => {
    return renderHook(() =>
      useCrud<TestItem>({
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
      })
    );
  };

  it("should update an item without optimistic updates", async () => {
    const { result } = setupHook();

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const itemToUpdate = result.current.items[0];

    await act(async () => {
      result.current.update(itemToUpdate, (draft) => {
        draft.name = "Updated Item 1";
        draft.count = 1;
      });
    });

    expect(result.current.items[0].data).toEqual({
      id: "1",
      name: "Updated Item 1",
      count: 1,
    });
    expect(result.current.items[0].state).toBe("idle");
    expect(result.current.items[0].optimistic).toBe(false);
  });

  it("should handle update with optimistic updates", async () => {
    const { result } = setupHook();

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const itemToUpdate = result.current.items[0];

    act(() => {
      result.current.update(
        itemToUpdate,
        (draft) => {
          draft.name = "Optimistically Updated";
          draft.count = 2;
        },
        true // isOptimistic = true
      );
    });

    // Check immediate optimistic update
    expect(result.current.items[0].data).toEqual({
      id: "1",
      name: "Optimistically Updated",
      count: 2,
    });
    expect(result.current.items[0].state).toBe("update");
    expect(result.current.items[0].optimistic).toBe(true);

    // Wait for backend update to complete
    await waitFor(() => {
      expect(result.current.items[0].state).toBe("idle");
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

    const { result } = setupHook();

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const itemToUpdate = result.current.items[0];

    await act(async () => {
      result.current.update(itemToUpdate, (draft) => {
        draft.name = "Will Fail";
      });
    });

    expect(result.current.items[0].state).toBe("error");
    expect(result.current.items[0].errors).toHaveLength(1);
    expect(result.current.hasError).toBe(true);
  });

  it("should update without backend call when no update function provided", async () => {
    const { result } = setupHook({ update: undefined });

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const itemToUpdate = result.current.items[0];

    await act(async () => {
      result.current.update(itemToUpdate, (draft) => {
        draft.name = "Local Update";
      });
    });

    expect(result.current.items[0].data.name).toBe("Local Update");
    expect(result.current.items[0].state).toBe("changed");
  });

  it("should handle cancellation of update operation", async () => {
    // Setup a delayed response
    server.use(
      http.patch("/api/items/:id", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return HttpResponse.json({ id: "1", name: "Delayed Update" });
      })
    );

    const { result } = setupHook();

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const originalItem = { ...result.current.items[0].data };
    const itemToUpdate = result.current.items[0];

    // Start update with optimistic update
    act(() => {
      result.current.update(
        itemToUpdate,
        (draft) => {
          draft.name = "Will Be Cancelled";
        },
        true
      );
    });

    // Verify optimistic update
    expect(result.current.items[0].data.name).toBe("Will Be Cancelled");
    expect(result.current.items[0].state).toBe("update");

    // Cancel the operation
    act(() => {
      result.current.cancelOperation(itemToUpdate.data.id);
    });

    // Wait for any async operations to complete
    await waitFor(() => {
      // The item should revert to its original state
      expect(result.current.items[0].data).toEqual(originalItem);
      expect(result.current.items[0].state).toBe("idle");
    });
  });

  it("should maintain other items' states during update", async () => {
    const { result } = setupHook();

    // Wait for initial items to load
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    const itemToUpdate = result.current.items[0];
    const otherItem = result.current.items[1];

    await act(async () => {
      result.current.update(itemToUpdate, (draft) => {
        draft.name = "Updated Item";
      });
    });

    // Check that other item remained unchanged
    const unchangedItem = result.current.items.find((item) => item.data.id === otherItem.data.id);
    expect(unchangedItem?.data).toEqual(otherItem.data);
    expect(unchangedItem?.state).toBe("idle");
  });
});
