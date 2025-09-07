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
  })
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
      })
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
    expect(result.current.items[0].state).toBe("idle");
  });

  it("should handle optimistic creation", async () => {
    const { result } = setupHook();

    await act(async () => {
      result.current.create({ name: "Optimistic Item" });
    });

    // Check immediate optimistic update
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].optimistic).toBe(true);
    expect(result.current.items[0].state).toBe("create");
    expect(result.current.items[0].data.name).toBe("Optimistic Item");

    // Wait for async update to complete
    await waitFor(() => {
      expect(result.current.items[0].state).toBe("idle");
    });

    // Verify final state after backend response
    expect(result.current.items[0].data.id).toBe("new-Optimistic Item");
    expect(result.current.items[0].optimistic).toBe(false);
  });

  it("should handle creation errors", async () => {
    // Override handler for this test to simulate error
    server.use(
      http.post("/api/items", () => {
        return HttpResponse.error();
      })
    );

    const { result } = setupHook();

    await act(async () => {
      result.current.create({ name: "Failed Item" });
    });

    expect(result.current.items[0].state).toBe("create");
    expect(result.current.items[0].errors).toHaveLength(1);
  });

  it("should create without backend call when no create function provided", async () => {
    const { result } = setupHook({ create: undefined });

    await act(async () => {
      result.current.create({ name: "Local Item" });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].data.name).toBe("Local Item");
    expect(result.current.items[0].state).toBe("idle");
  });

  it("should handle network errors", async () => {
    // Override handler to simulate network error
    server.use(
      http.post("/api/items", () => {
        return HttpResponse.error();
      })
    );

    const { result } = setupHook();

    await act(async () => {
      result.current.create({ name: "Error Item" });
    });

    expect(result.current.items[0].state).toBe("create");
    expect(result.current.items[0].errors).toHaveLength(1);
    expect(result.current.hasError).toBe(true);
  });
});
