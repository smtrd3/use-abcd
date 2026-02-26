import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSyncServer, createCrudHandler } from "./server";
import type { Result } from "../types";

interface TestItem {
  id: string;
  name: string;
  email?: string;
}

interface TestQuery {
  page: number;
  limit: number;
  search?: string;
}

const mockItems: TestItem[] = [
  { id: "1", name: "Item 1", email: "item1@test.com" },
  { id: "2", name: "Item 2", email: "item2@test.com" },
  { id: "3", name: "Item 3" },
];

const createRequest = <T, Q>(
  body: { query?: Q; changes?: Array<{ id: string; type: string; data: T }> },
  method = "POST",
): Request => {
  return new Request("http://localhost/api/items", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

describe("createSyncServer", () => {
  describe("HTTP Method Validation", () => {
    it("rejects GET requests with 405", async () => {
      const handler = createSyncServer<TestItem>(async () => ({}));
      const request = new Request("http://localhost/api/items", { method: "GET" });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(405);
      expect(body.error).toBe("Method not allowed. Use POST.");
    });

    it("rejects PUT requests with 405", async () => {
      const handler = createSyncServer<TestItem>(async () => ({}));
      const request = new Request("http://localhost/api/items", { method: "PUT" });

      const response = await handler(request);

      expect(response.status).toBe(405);
    });

    it("rejects DELETE requests with 405", async () => {
      const handler = createSyncServer<TestItem>(async () => ({}));
      const request = new Request("http://localhost/api/items", { method: "DELETE" });

      const response = await handler(request);

      expect(response.status).toBe(405);
    });

    it("accepts POST requests", async () => {
      const handler = createSyncServer<TestItem, TestQuery>(async (request) => {
        if (request.query !== undefined) return { results: mockItems };
        return {};
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Request Body Parsing", () => {
    it("rejects invalid JSON with 400", async () => {
      const handler = createSyncServer<TestItem>(async () => ({}));
      const request = new Request("http://localhost/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json{",
      });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid JSON body");
    });

    it("rejects empty body with 400", async () => {
      const handler = createSyncServer<TestItem>(async () => ({}));
      const request = createRequest<TestItem, unknown>({});

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Request body must contain 'query' and/or 'changes'");
    });

    it("rejects body without query or changes", async () => {
      const handler = createSyncServer<TestItem>(async () => ({}));
      const request = new Request("http://localhost/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foo: "bar" }),
      });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Request body must contain 'query' and/or 'changes'");
    });
  });

  describe("Fetch Operations (Query)", () => {
    it("returns items when query is provided", async () => {
      const handler = createSyncServer<TestItem, TestQuery>(async (request) => {
        if (request.query !== undefined) return { results: mockItems };
        return {};
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.results).toEqual(mockItems);
    });

    it("passes query to handler", async () => {
      const crudHandler = vi.fn().mockResolvedValue({ results: mockItems });
      const handler = createSyncServer<TestItem, TestQuery>(crudHandler);
      const query = { page: 2, limit: 5, search: "test" };
      const request = createRequest<TestItem, TestQuery>({ query });

      await handler(request);

      expect(crudHandler).toHaveBeenCalledWith(expect.objectContaining({ query }));
    });

    it("handles async handler", async () => {
      const handler = createSyncServer<TestItem, TestQuery>(async (request) => {
        await new Promise((r) => setTimeout(r, 10));
        if (request.query !== undefined) return { results: mockItems };
        return {};
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.results).toEqual(mockItems);
    });

    it("handles handler errors gracefully", async () => {
      const handler = createSyncServer<TestItem, TestQuery>(async () => {
        throw new Error("Database connection failed");
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Database connection failed");
    });
  });

  describe("Sync Operations (Changes)", () => {
    it("processes create change successfully", async () => {
      const handler = createSyncServer<TestItem>(async (request) => {
        if (request.changes) {
          const syncResults: Record<string, Result> = {};
          for (const change of request.changes) {
            syncResults[change.id] = { status: "success" };
          }
          return { syncResults };
        }
        return {};
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "New Item" } }],
      });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.syncResults).toEqual({ "temp-1": { status: "success" } });
    });

    it("handles sync error", async () => {
      const handler = createSyncServer<TestItem>(async (request) => {
        if (request.changes) {
          const syncResults: Record<string, Result> = {};
          for (const change of request.changes) {
            syncResults[change.id] = { status: "error", error: "Duplicate entry" };
          }
          return { syncResults };
        }
        return {};
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "New Item" } }],
      });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.syncResults["temp-1"]).toEqual({
        status: "error",
        error: "Duplicate entry",
      });
    });

    it("processes multiple changes", async () => {
      const handler = createSyncServer<TestItem>(async (request) => {
        if (request.changes) {
          const syncResults: Record<string, Result> = {};
          for (const change of request.changes) {
            syncResults[change.id] = { status: "success" };
          }
          return { syncResults };
        }
        return {};
      });
      const request = createRequest<TestItem, unknown>({
        changes: [
          { id: "1", type: "create", data: { id: "1", name: "Item 1" } },
          { id: "2", type: "create", data: { id: "2", name: "Item 2" } },
          { id: "3", type: "create", data: { id: "3", name: "Item 3" } },
        ],
      });

      const response = await handler(request);
      const body = await response.json();

      expect(Object.keys(body.syncResults)).toHaveLength(3);
      expect(Object.values(body.syncResults).every((r: Result) => r.status === "success")).toBe(
        true,
      );
    });

    it("handles mixed operation types", async () => {
      const handler = createSyncServer<TestItem>(async (request) => {
        if (request.changes) {
          const syncResults: Record<string, Result> = {};
          for (const change of request.changes) {
            syncResults[change.id] = { status: "success" };
          }
          return { syncResults };
        }
        return {};
      });
      const request = createRequest<TestItem, unknown>({
        changes: [
          { id: "temp-1", type: "create", data: { id: "temp-1", name: "New" } },
          { id: "1", type: "update", data: { id: "1", name: "Updated" } },
          { id: "2", type: "delete", data: { id: "2", name: "To Delete" } },
        ],
      });

      const response = await handler(request);
      const body = await response.json();

      expect(Object.keys(body.syncResults)).toHaveLength(3);
      expect(Object.values(body.syncResults).every((r: Result) => r.status === "success")).toBe(
        true,
      );
    });

    it("continues processing after individual failures", async () => {
      const handler = createSyncServer<TestItem>(async (request) => {
        if (request.changes) {
          const syncResults: Record<string, Result> = {};
          for (const change of request.changes) {
            if (change.data.name === "fail") {
              syncResults[change.id] = { status: "error", error: "Failed" };
            } else {
              syncResults[change.id] = { status: "success" };
            }
          }
          return { syncResults };
        }
        return {};
      });
      const request = createRequest<TestItem, unknown>({
        changes: [
          { id: "1", type: "create", data: { id: "1", name: "success" } },
          { id: "2", type: "create", data: { id: "2", name: "fail" } },
          { id: "3", type: "create", data: { id: "3", name: "success" } },
        ],
      });

      const response = await handler(request);
      const body = await response.json();

      expect(body.syncResults["1"].status).toBe("success");
      expect(body.syncResults["2"].status).toBe("error");
      expect(body.syncResults["3"].status).toBe("success");
    });
  });

  describe("Combined Query and Changes", () => {
    it("handles both query and changes in single request", async () => {
      const handler = createSyncServer<TestItem, TestQuery>(async (request) => {
        const response: { results?: TestItem[]; syncResults?: Record<string, Result> } = {};

        if (request.query !== undefined) {
          response.results = mockItems;
        }

        if (request.changes) {
          const syncResults: Record<string, Result> = {};
          for (const change of request.changes) {
            syncResults[change.id] = { status: "success" };
          }
          response.syncResults = syncResults;
        }

        return response;
      });
      const request = createRequest<TestItem, TestQuery>({
        query: { page: 1, limit: 10 },
        changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "New" } }],
      });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.results).toEqual(mockItems);
      expect(body.syncResults["temp-1"].status).toBe("success");
    });

    it("returns only results when only query provided", async () => {
      const handler = createSyncServer<TestItem, TestQuery>(async (request) => {
        if (request.query !== undefined) return { results: mockItems };
        return {};
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler(request);
      const body = await response.json();

      expect(body.results).toBeDefined();
      expect(body.syncResults).toBeUndefined();
    });

    it("returns only syncResults when only changes provided", async () => {
      const handler = createSyncServer<TestItem>(async (request) => {
        if (request.changes) {
          const syncResults: Record<string, Result> = {};
          for (const change of request.changes) {
            syncResults[change.id] = { status: "success" };
          }
          return { syncResults };
        }
        return {};
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
      });

      const response = await handler(request);
      const body = await response.json();

      expect(body.results).toBeUndefined();
      expect(body.syncResults).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("catches and returns handler exceptions", async () => {
      const handler = createSyncServer<TestItem>(async () => {
        throw new Error("Unexpected database error");
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
      });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Unexpected database error");
    });

    it("handles non-Error exceptions", async () => {
      const handler = createSyncServer<TestItem>(async () => {
        throw "string error";
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
      });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Internal server error");
    });

    it("handles async handler rejection", async () => {
      const handler = createSyncServer<TestItem>(async () => {
        await Promise.reject(new Error("Async error"));
        return {};
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
      });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Async error");
    });
  });

  describe("Response Headers", () => {
    it("returns JSON content type", async () => {
      const handler = createSyncServer<TestItem, TestQuery>(async (request) => {
        if (request.query !== undefined) return { results: mockItems };
        return {};
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler(request);

      expect(response.headers.get("Content-Type")).toBe("application/json");
    });

    it("returns JSON content type on errors", async () => {
      const handler = createSyncServer<TestItem>(async () => ({}));
      const request = new Request("http://localhost/api/items", { method: "GET" });

      const response = await handler(request);

      expect(response.headers.get("Content-Type")).toBe("application/json");
    });
  });

  describe("Edge Cases", () => {
    it("handles empty changes array", async () => {
      const handler = createSyncServer<TestItem>(async (request) => {
        if (request.changes) return { syncResults: {} };
        return {};
      });
      const request = createRequest<TestItem, unknown>({ changes: [] });

      const response = await handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.syncResults).toEqual({});
    });

    it("handles null query value", async () => {
      const handler = createSyncServer<TestItem, TestQuery>(async (request) => {
        // null query is passed through (null !== undefined)
        if (request.query !== undefined) return { results: mockItems };
        return {};
      });
      const request = new Request("http://localhost/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: null }),
      });

      const response = await handler(request);
      const body = await response.json();

      // null !== undefined, so query is passed to handler
      expect(response.status).toBe(200);
      expect(body.results).toEqual(mockItems);
    });

    it("handles large batch of changes", async () => {
      const handler = createSyncServer<TestItem>(async (request) => {
        if (request.changes) {
          const syncResults: Record<string, Result> = {};
          for (const change of request.changes) {
            syncResults[change.id] = { status: "success" };
          }
          return { syncResults };
        }
        return {};
      });

      const changes = Array.from({ length: 100 }, (_, i) => ({
        id: `temp-${i}`,
        type: "create" as const,
        data: { id: `temp-${i}`, name: `Item ${i}` },
      }));

      const request = createRequest<TestItem, unknown>({ changes });

      const response = await handler(request);
      const body = await response.json();

      expect(Object.keys(body.syncResults)).toHaveLength(100);
      expect(Object.values(body.syncResults).every((r: Result) => r.status === "success")).toBe(
        true,
      );
    });
  });
});

describe("createCrudHandler", () => {
  const db = new Map<string, TestItem>([
    ["1", { id: "1", name: "Item 1", email: "item1@test.com" }],
    ["2", { id: "2", name: "Item 2", email: "item2@test.com" }],
  ]);

  const createHandler = () =>
    createCrudHandler<TestItem, TestQuery>({
      fetch: ({ query }) => {
        const items = [...db.values()];
        if (query.search) {
          return items.filter((i) => i.name.toLowerCase().includes(query.search!.toLowerCase()));
        }
        return items.slice(0, query.limit);
      },
      create: (record) => {
        db.set(record.data.id, record.data);
      },
      update: (record) => {
        if (!db.has(record.data.id)) throw new Error("Not found");
        db.set(record.data.id, record.data);
      },
      remove: (record) => {
        if (!db.has(record.data.id)) throw new Error("Not found");
        db.delete(record.data.id);
      },
    });

  beforeEach(() => {
    db.clear();
    db.set("1", { id: "1", name: "Item 1", email: "item1@test.com" });
    db.set("2", { id: "2", name: "Item 2", email: "item2@test.com" });
  });

  it("handles fetch via query", async () => {
    const handler = createHandler();
    const result = await handler({ query: { page: 1, limit: 10 } });

    expect(result.results).toHaveLength(2);
    expect(result.results![0].name).toBe("Item 1");
    expect(result.serverTimeStamp).toBeDefined();
    expect(typeof result.serverTimeStamp).toBe("string");
  });

  it("handles create changes", async () => {
    const handler = createHandler();
    const result = await handler({
      changes: [{ id: "3", type: "create", data: { id: "3", name: "Item 3" } }],
    });

    expect(result.syncResults!["3"]).toEqual({ status: "success" });
    expect(db.has("3")).toBe(true);
  });

  it("handles update changes", async () => {
    const handler = createHandler();
    const result = await handler({
      changes: [{ id: "1", type: "update", data: { id: "1", name: "Updated" } }],
    });

    expect(result.syncResults!["1"]).toEqual({ status: "success" });
    expect(db.get("1")!.name).toBe("Updated");
  });

  it("handles delete changes", async () => {
    const handler = createHandler();
    const result = await handler({
      changes: [{ id: "1", type: "delete", data: { id: "1", name: "Item 1" } }],
    });

    expect(result.syncResults!["1"]).toEqual({ status: "success" });
    expect(db.has("1")).toBe(false);
  });

  it("captures errors per item", async () => {
    const handler = createHandler();
    const result = await handler({
      changes: [{ id: "999", type: "update", data: { id: "999", name: "Nope" } }],
    });

    expect(result.syncResults!["999"]).toEqual({ status: "error", error: "Not found" });
  });

  it("handles mixed query and changes", async () => {
    const handler = createHandler();
    const result = await handler({
      query: { page: 1, limit: 10 },
      changes: [{ id: "3", type: "create", data: { id: "3", name: "Item 3" } }],
    });

    expect(result.results).toHaveLength(3); // changes processed first, then fetch
    expect(result.syncResults!["3"]).toEqual({ status: "success" });
  });

  it("handles multiple changes in batch", async () => {
    const handler = createHandler();
    const result = await handler({
      changes: [
        { id: "3", type: "create", data: { id: "3", name: "Item 3" } },
        { id: "1", type: "update", data: { id: "1", name: "Updated 1" } },
        { id: "2", type: "delete", data: { id: "2", name: "Item 2" } },
      ],
    });

    expect(Object.keys(result.syncResults!)).toHaveLength(3);
    expect(result.syncResults!["3"]).toEqual({ status: "success" });
    expect(result.syncResults!["1"]).toEqual({ status: "success" });
    expect(result.syncResults!["2"]).toEqual({ status: "success" });
    expect(db.size).toBe(2); // 2 original - 1 deleted + 1 created
  });

  it("succeeds for unhandled change types when handler not configured", async () => {
    const handler = createCrudHandler<TestItem, TestQuery>({
      fetch: () => [...db.values()],
    });

    const result = await handler({
      changes: [{ id: "3", type: "create", data: { id: "3", name: "Item 3" } }],
    });

    expect(result.syncResults!["3"]).toEqual({ status: "success" });
    expect(db.has("3")).toBe(false); // not actually created since no create handler
  });

  it("works with async handlers", async () => {
    const handler = createCrudHandler<TestItem, TestQuery>({
      fetch: async ({ query }) => {
        await new Promise((r) => setTimeout(r, 10));
        return [...db.values()].slice(0, query.limit);
      },
      create: async (record) => {
        await new Promise((r) => setTimeout(r, 10));
        db.set(record.data.id, record.data);
      },
    });

    const result = await handler({
      query: { page: 1, limit: 10 },
      changes: [{ id: "3", type: "create", data: { id: "3", name: "Async Item" } }],
    });

    expect(result.results).toHaveLength(3); // changes processed first, then fetch
    expect(result.syncResults!["3"]).toEqual({ status: "success" });
    expect(db.get("3")!.name).toBe("Async Item");
  });

  it("integrates with createSyncServer", async () => {
    const handler = createSyncServer<TestItem, TestQuery>(createHandler());
    const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(2);
  });

  describe("serverState", () => {
    it("returns serverState when fetch returns object with items and serverState", async () => {
      const handler = createCrudHandler<TestItem, TestQuery, { total: number; hasMore: boolean }>({
        fetch: ({ query }) => {
          const items = [...db.values()].slice(0, query.limit);
          return { items, serverState: { total: db.size, hasMore: db.size > query.limit } };
        },
      });

      const result = await handler({ query: { page: 1, limit: 1 } });

      expect(result.results).toHaveLength(1);
      expect(result.serverState).toEqual({ total: 2, hasMore: true });
    });

    it("does not set serverState when fetch returns plain array", async () => {
      const handler = createHandler();
      const result = await handler({ query: { page: 1, limit: 10 } });

      expect(result.results).toHaveLength(2);
      expect(result.serverState).toBeUndefined();
    });

    it("does not set serverState when fetch returns object without serverState", async () => {
      const handler = createCrudHandler<TestItem, TestQuery>({
        fetch: ({ query }) => {
          const items = [...db.values()].slice(0, query.limit);
          return { items };
        },
      });

      const result = await handler({ query: { page: 1, limit: 10 } });

      expect(result.results).toHaveLength(2);
      expect(result.serverState).toBeUndefined();
    });

    it("passes serverState through createSyncServer to HTTP response", async () => {
      const handler = createSyncServer<TestItem, TestQuery>(
        createCrudHandler<TestItem, TestQuery, { total: number }>({
          fetch: () => ({ items: [...db.values()], serverState: { total: db.size } }),
        }),
      );
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler(request);
      const body = await response.json();

      expect(body.results).toHaveLength(2);
      expect(body.serverState).toEqual({ total: 2 });
    });
  });

  describe("serverTimeStamp", () => {
    it("always includes serverTimeStamp in response", async () => {
      const handler = createHandler();
      const result = await handler({ query: { page: 1, limit: 10 } });

      expect(result.serverTimeStamp).toBeDefined();
      expect(typeof result.serverTimeStamp).toBe("string");
      expect(result.serverTimeStamp!.length).toBeGreaterThan(0);
    });

    it("includes serverTimeStamp even for changes-only requests", async () => {
      const handler = createHandler();
      const result = await handler({
        changes: [{ id: "3", type: "create", data: { id: "3", name: "Item 3" } }],
      });

      expect(result.serverTimeStamp).toBeDefined();
    });

    it("generates same serverTimeStamp for all records in a batch", async () => {
      const timestamps: string[] = [];
      const handler = createCrudHandler<TestItem, TestQuery>({
        create: (record) => {
          timestamps.push(record.serverTimeStamp);
        },
        update: (record) => {
          timestamps.push(record.serverTimeStamp);
        },
      });

      await handler({
        changes: [
          { id: "10", type: "create", data: { id: "10", name: "A" } },
          { id: "11", type: "create", data: { id: "11", name: "B" } },
          { id: "1", type: "update", data: { id: "1", name: "C" } },
        ],
      });

      expect(timestamps).toHaveLength(3);
      expect(timestamps[0]).toBe(timestamps[1]);
      expect(timestamps[1]).toBe(timestamps[2]);
    });

    it("wraps change data into ServerRecord format", async () => {
      let capturedRecord: unknown = null;
      const handler = createCrudHandler<TestItem, TestQuery>({
        create: (record) => {
          capturedRecord = record;
        },
      });

      await handler({
        changes: [{ id: "5", type: "create", data: { id: "5", name: "Test" } }],
      });

      expect(capturedRecord).toEqual({
        id: "5",
        data: { id: "5", name: "Test" },
        serverTimeStamp: expect.any(String),
        deleted: false,
      });
    });

    it("sets deleted flag for delete changes", async () => {
      let capturedRecord: unknown = null;
      const handler = createCrudHandler<TestItem, TestQuery>({
        remove: (record) => {
          capturedRecord = record;
        },
      });

      await handler({
        changes: [{ id: "1", type: "delete", data: { id: "1", name: "Item 1" } }],
      });

      expect(capturedRecord).toEqual({
        id: "1",
        data: { id: "1", name: "Item 1" },
        serverTimeStamp: expect.any(String),
        deleted: true,
      });
    });

    it("passes serverTimeStamp through createSyncServer to HTTP response", async () => {
      const handler = createSyncServer<TestItem, TestQuery>(createHandler());
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler(request);
      const body = await response.json();

      expect(body.serverTimeStamp).toBeDefined();
      expect(typeof body.serverTimeStamp).toBe("string");
    });
  });
});
