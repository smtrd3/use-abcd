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
  }),
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
      }),
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
      }),
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

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].transitions.get("default").at(0)).toBe("delete");
    expect(result.current.items[0].errors.size).toBe(1);
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
    expect(result.current.items[0].transitions.size).toBe(0);
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
    expect(remainingItem.transitions.size).toBe(0);
  });
});
