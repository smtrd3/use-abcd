import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { useCrud, type Item } from "../useCrud";

interface TestItem extends Item {
  name: string;
}

// MSW server setup
const server = setupServer(
  http.post("/api/items", async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json({ id: `new-${body.name}` });
  }),
);

// Enable API mocking before tests
beforeAll(() => server.listen());

// Reset any runtime request handlers we may add during the tests
afterEach(() => server.resetHandlers());

// Disable API mocking after the tests are done
afterAll(() => server.close());

describe("useCrud - create operation", () => {
  const defaultContext = { userId: "123" };

  const setupHook = (options = {}) => {
    return renderHook(() =>
      useCrud<TestItem>({
        id: "test",
        context: defaultContext,
        create: async (item, { signal }) => {
          const response = await fetch("/api/items", {
            method: "POST",
            body: JSON.stringify(item),
            signal,
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
  it("should create an item without optimistic updates", async () => {
    const { result } = setupHook();

    await act(async () => {
      result.current.create({ name: "Test Item" });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].data).toEqual({
      id: "new-Test Item",
      name: "Test Item",
    });
    expect(result.current.items[0].transitions.size).toBe(0);
  });

  it("should handle creation errors", async () => {
    // Override handler for this test to simulate error
    server.use(
      http.post("/api/items", () => {
        return HttpResponse.error();
      }),
    );

    const { result } = setupHook();

    await act(async () => {
      result.current.create({ name: "Failed Item" });
    });

    expect(result.current.items[0].transitions.get("default").at(0)).toBe("create");
    expect(result.current.items[0].errors.size).toBe(1);
  });

  it("should create without backend call when no create function provided", async () => {
    const { result } = setupHook({ create: undefined });

    await act(async () => {
      result.current.create({ name: "Local Item" });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].data.name).toBe("Local Item");
    expect(result.current.items[0].transitions.size).toBe(0);
  });

  it("should handle network errors", async () => {
    // Override handler to simulate network error
    server.use(
      http.post("/api/items", () => {
        return HttpResponse.error();
      }),
    );

    const { result } = setupHook();

    await act(async () => {
      result.current.create({ name: "Error Item" });
    });

    expect(result.current.items[0].transitions.get("default").at(0)).toBe("create");
    expect(result.current.items[0].errors.size).toBe(1);
    expect(result.current.hasError).toBe(true);
  });

  it("should handle cancellation of create operation", async () => {
    // Setup a delayed response
    server.use(
      http.post("/api/items", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return HttpResponse.json({ id: "new-delayed" });
      }),
    );

    const { result } = setupHook();

    // Start the creation process
    act(() => {
      result.current.create({ name: "Cancelled Item" });
    });

    // Verify the item is in creating state
    expect(result.current.items[0].transitions.get("default").at(0)).toBe("create");
    expect(result.current.items[0].optimistic).toBe(true);

    // Get the temporary ID of the item being created
    const tempId = result.current.items[0].data.id;

    // Cancel the operation
    act(() => {
      result.current.cancelOperation(tempId);
    });

    // Wait for any async operations to complete
    await waitFor(() => {
      // The item should be removed after cancellation
      expect(result.current.items).toHaveLength(0);
    });
  });
});
