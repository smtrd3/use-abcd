import { describe, it, expect, vi } from "vitest";
import {
  createSyncServer,
  serverSyncSuccess,
  serverSyncError,
  type ServerSyncHandlerConfig,
} from "./server";
import type { Schema, SyncRequestBody } from "./types";

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

const createRequest = <T, Q>(body: SyncRequestBody<T, Q>, method = "POST"): Request => {
  return new Request("http://localhost/api/items", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

const createMockSchema = <T>(validator: (data: unknown) => boolean, errorMessage = "Validation failed"): Schema<T> => ({
  safeParse: (data: unknown) => {
    if (validator(data)) {
      return { success: true, data: data as T };
    }
    return { success: false, error: { message: errorMessage } };
  },
});

describe("createSyncServer", () => {
  describe("Helper Functions", () => {
    it("serverSyncSuccess returns success result", () => {
      expect(serverSyncSuccess()).toEqual({ success: true });
      expect(serverSyncSuccess({ newId: "abc" })).toEqual({ success: true, newId: "abc" });
    });

    it("serverSyncError returns error result", () => {
      expect(serverSyncError("Something went wrong")).toEqual({
        success: false,
        error: "Something went wrong",
      });
    });
  });

  describe("HTTP Method Validation", () => {
    it("rejects GET requests with 405", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = new Request("http://localhost/api/items", { method: "GET" });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(405);
      expect(body.error).toBe("Method not allowed. Use POST.");
    });

    it("rejects PUT requests with 405", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = new Request("http://localhost/api/items", { method: "PUT" });

      const response = await handler.handler(request);

      expect(response.status).toBe(405);
    });

    it("rejects DELETE requests with 405", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = new Request("http://localhost/api/items", { method: "DELETE" });

      const response = await handler.handler(request);

      expect(response.status).toBe(405);
    });

    it("accepts POST requests", async () => {
      const handler = createSyncServer<TestItem, TestQuery>({
        fetch: () => mockItems,
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler.handler(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Request Body Parsing", () => {
    it("rejects invalid JSON with 400", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = new Request("http://localhost/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json{",
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid JSON body");
    });

    it("rejects empty body with 400", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = createRequest<TestItem, unknown>({});

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Request body must contain 'query' and/or 'changes'");
    });

    it("rejects body without query or changes", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = new Request("http://localhost/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foo: "bar" }),
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Request body must contain 'query' and/or 'changes'");
    });

    it("rejects non-array changes with 400", async () => {
      const handler = createSyncServer<TestItem>({
        create: () => serverSyncSuccess(),
      });
      const request = new Request("http://localhost/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: "not an array" }),
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Request body must contain 'query' and/or 'changes'");
    });
  });

  describe("Fetch Operations (Query)", () => {
    it("returns items when query is provided", async () => {
      const handler = createSyncServer<TestItem, TestQuery>({
        fetch: () => mockItems,
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.results).toEqual(mockItems);
    });

    it("passes query to fetch handler", async () => {
      const fetchFn = vi.fn().mockReturnValue(mockItems);
      const handler = createSyncServer<TestItem, TestQuery>({
        fetch: fetchFn,
      });
      const query = { page: 2, limit: 5, search: "test" };
      const request = createRequest<TestItem, TestQuery>({ query });

      await handler.handler(request);

      expect(fetchFn).toHaveBeenCalledWith(query);
    });

    it("returns 501 when fetch handler not configured", async () => {
      const handler = createSyncServer<TestItem, TestQuery>({});
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(501);
      expect(body.error).toBe("Fetch handler not configured");
    });

    it("handles async fetch handler", async () => {
      const handler = createSyncServer<TestItem, TestQuery>({
        fetch: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return mockItems;
        },
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.results).toEqual(mockItems);
    });

    it("handles fetch handler errors gracefully", async () => {
      const handler = createSyncServer<TestItem, TestQuery>({
        fetch: () => {
          throw new Error("Database connection failed");
        },
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Database connection failed");
    });
  });

  describe("Query Validation", () => {
    it("validates query with querySchema", async () => {
      const querySchema = createMockSchema<TestQuery>(
        (data) => typeof (data as TestQuery).page === "number" && typeof (data as TestQuery).limit === "number",
        "Invalid query parameters",
      );

      const handler = createSyncServer<TestItem, TestQuery>({
        querySchema,
        fetch: () => mockItems,
      });

      const validRequest = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });
      const validResponse = await handler.handler(validRequest);

      expect(validResponse.status).toBe(200);
    });

    it("rejects invalid query with validation error", async () => {
      const querySchema = createMockSchema<TestQuery>(
        (data) => typeof (data as TestQuery).page === "number",
        "page must be a number",
      );

      const handler = createSyncServer<TestItem, TestQuery>({
        querySchema,
        fetch: () => mockItems,
      });

      const request = new Request("http://localhost/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: { page: "invalid", limit: 10 } }),
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain("Validation error");
      expect(body.error).toContain("page must be a number");
    });

    it("passes validated data to fetch handler", async () => {
      const fetchFn = vi.fn().mockReturnValue(mockItems);
      const querySchema: Schema<TestQuery> = {
        safeParse: (data) => ({
          success: true,
          data: { ...(data as TestQuery), validated: true } as unknown as TestQuery,
        }),
      };

      const handler = createSyncServer<TestItem, TestQuery>({
        querySchema,
        fetch: fetchFn,
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      await handler.handler(request);

      expect(fetchFn).toHaveBeenCalledWith(expect.objectContaining({ validated: true }));
    });
  });

  describe("Create Operations", () => {
    it("processes create change successfully", async () => {
      const handler = createSyncServer<TestItem>({
        create: (data) => serverSyncSuccess({ newId: `new-${data.name}` }),
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "New Item" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.syncResults).toHaveLength(1);
      expect(body.syncResults[0]).toEqual({
        id: "temp-1",
        status: "success",
        newId: "new-New Item",
      });
    });

    it("handles create error", async () => {
      const handler = createSyncServer<TestItem>({
        create: () => serverSyncError("Duplicate entry"),
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "New Item" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.syncResults[0]).toEqual({
        id: "temp-1",
        status: "error",
        error: "Duplicate entry",
      });
    });

    it("returns error when create handler not configured", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "New Item" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0]).toEqual({
        id: "temp-1",
        status: "error",
        error: "Create handler not configured",
      });
    });
  });

  describe("Update Operations", () => {
    it("processes update change successfully", async () => {
      const updateFn = vi.fn().mockReturnValue(serverSyncSuccess());
      const handler = createSyncServer<TestItem>({
        update: updateFn,
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "update", data: { id: "1", name: "Updated Item" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.syncResults[0]).toEqual({ id: "1", status: "success" });
      expect(updateFn).toHaveBeenCalledWith("1", { id: "1", name: "Updated Item" });
    });

    it("handles update error", async () => {
      const handler = createSyncServer<TestItem>({
        update: () => serverSyncError("Item not found"),
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "999", type: "update", data: { id: "999", name: "Updated" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0]).toEqual({
        id: "999",
        status: "error",
        error: "Item not found",
      });
    });

    it("returns error when update handler not configured", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "update", data: { id: "1", name: "Updated" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0].error).toBe("Update handler not configured");
    });
  });

  describe("Delete Operations", () => {
    it("processes delete change successfully", async () => {
      const deleteFn = vi.fn().mockReturnValue(serverSyncSuccess());
      const handler = createSyncServer<TestItem>({
        delete: deleteFn,
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "delete", data: { id: "1", name: "Item 1" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0]).toEqual({ id: "1", status: "success" });
      expect(deleteFn).toHaveBeenCalledWith("1", { id: "1", name: "Item 1" });
    });

    it("handles delete error", async () => {
      const handler = createSyncServer<TestItem>({
        delete: () => serverSyncError("Cannot delete: has dependencies"),
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "delete", data: { id: "1", name: "Item 1" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0].error).toBe("Cannot delete: has dependencies");
    });

    it("returns error when delete handler not configured", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "delete", data: { id: "1", name: "Item 1" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0].error).toBe("Delete handler not configured");
    });
  });

  describe("Data Validation (Schema)", () => {
    it("validates change data with schema", async () => {
      const schema = createMockSchema<TestItem>(
        (data) => typeof (data as TestItem).name === "string" && (data as TestItem).name.length > 0,
        "name is required",
      );

      const handler = createSyncServer<TestItem>({
        schema,
        create: () => serverSyncSuccess({ newId: "new-1" }),
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "Valid Item" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0].status).toBe("success");
    });

    it("rejects invalid data with validation error", async () => {
      const schema = createMockSchema<TestItem>(
        (data) => typeof (data as TestItem).email === "string" && (data as TestItem).email!.includes("@"),
        "email must be valid",
      );

      const handler = createSyncServer<TestItem>({
        schema,
        create: () => serverSyncSuccess({ newId: "new-1" }),
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "Item", email: "invalid" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0]).toEqual({
        id: "temp-1",
        status: "error",
        error: "Validation failed: email must be valid",
      });
    });

    it("validates each change independently", async () => {
      const schema = createMockSchema<TestItem>(
        (data) => (data as TestItem).name !== "invalid",
        "invalid name",
      );

      const handler = createSyncServer<TestItem>({
        schema,
        create: () => serverSyncSuccess({ newId: "new" }),
      });
      const request = createRequest<TestItem, unknown>({
        changes: [
          { id: "1", type: "create", data: { id: "1", name: "valid" } },
          { id: "2", type: "create", data: { id: "2", name: "invalid" } },
          { id: "3", type: "create", data: { id: "3", name: "also valid" } },
        ],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0].status).toBe("success");
      expect(body.syncResults[1].status).toBe("error");
      expect(body.syncResults[2].status).toBe("success");
    });
  });

  describe("Batch Processing", () => {
    it("processes multiple changes in parallel", async () => {
      const createOrder: string[] = [];
      const handler = createSyncServer<TestItem>({
        create: async (data) => {
          await new Promise((r) => setTimeout(r, Math.random() * 10));
          createOrder.push(data.id);
          return serverSyncSuccess({ newId: data.id });
        },
      });
      const request = createRequest<TestItem, unknown>({
        changes: [
          { id: "1", type: "create", data: { id: "1", name: "Item 1" } },
          { id: "2", type: "create", data: { id: "2", name: "Item 2" } },
          { id: "3", type: "create", data: { id: "3", name: "Item 3" } },
        ],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults).toHaveLength(3);
      expect(body.syncResults.every((r: { status: string }) => r.status === "success")).toBe(true);
    });

    it("handles mixed operation types", async () => {
      const handler = createSyncServer<TestItem>({
        create: () => serverSyncSuccess({ newId: "new-1" }),
        update: () => serverSyncSuccess(),
        delete: () => serverSyncSuccess(),
      });
      const request = createRequest<TestItem, unknown>({
        changes: [
          { id: "temp-1", type: "create", data: { id: "temp-1", name: "New" } },
          { id: "1", type: "update", data: { id: "1", name: "Updated" } },
          { id: "2", type: "delete", data: { id: "2", name: "To Delete" } },
        ],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults).toHaveLength(3);
      expect(body.syncResults[0].newId).toBe("new-1");
      expect(body.syncResults.every((r: { status: string }) => r.status === "success")).toBe(true);
    });

    it("continues processing after individual failures", async () => {
      const handler = createSyncServer<TestItem>({
        create: (data) =>
          data.name === "fail" ? serverSyncError("Failed") : serverSyncSuccess({ newId: data.id }),
      });
      const request = createRequest<TestItem, unknown>({
        changes: [
          { id: "1", type: "create", data: { id: "1", name: "success" } },
          { id: "2", type: "create", data: { id: "2", name: "fail" } },
          { id: "3", type: "create", data: { id: "3", name: "success" } },
        ],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0].status).toBe("success");
      expect(body.syncResults[1].status).toBe("error");
      expect(body.syncResults[2].status).toBe("success");
    });

    it("handles unknown change types", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = new Request("http://localhost/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: [{ id: "1", type: "unknown", data: { id: "1", name: "Item" } }],
        }),
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0]).toEqual({
        id: "1",
        status: "error",
        error: "Unknown change type: unknown",
      });
    });
  });

  describe("Combined Query and Changes", () => {
    it("handles both query and changes in single request", async () => {
      const handler = createSyncServer<TestItem, TestQuery>({
        fetch: () => mockItems,
        create: () => serverSyncSuccess({ newId: "new-1" }),
      });
      const request = createRequest<TestItem, TestQuery>({
        query: { page: 1, limit: 10 },
        changes: [{ id: "temp-1", type: "create", data: { id: "temp-1", name: "New" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.results).toEqual(mockItems);
      expect(body.syncResults).toHaveLength(1);
      expect(body.syncResults[0].status).toBe("success");
    });

    it("returns only results when only query provided", async () => {
      const handler = createSyncServer<TestItem, TestQuery>({
        fetch: () => mockItems,
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.results).toBeDefined();
      expect(body.syncResults).toBeUndefined();
    });

    it("returns only syncResults when only changes provided", async () => {
      const handler = createSyncServer<TestItem>({
        create: () => serverSyncSuccess({ newId: "new-1" }),
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.results).toBeUndefined();
      expect(body.syncResults).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("catches and returns handler exceptions", async () => {
      const handler = createSyncServer<TestItem>({
        create: () => {
          throw new Error("Unexpected database error");
        },
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0]).toEqual({
        id: "1",
        status: "error",
        error: "Unexpected database error",
      });
    });

    it("handles non-Error exceptions", async () => {
      const handler = createSyncServer<TestItem>({
        create: () => {
          throw "string error";
        },
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0].error).toBe("Unknown error");
    });

    it("handles async handler rejection", async () => {
      const handler = createSyncServer<TestItem>({
        create: async () => {
          await Promise.reject(new Error("Async error"));
          return serverSyncSuccess();
        },
      });
      const request = createRequest<TestItem, unknown>({
        changes: [{ id: "1", type: "create", data: { id: "1", name: "New" } }],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults[0].error).toBe("Async error");
    });
  });

  describe("Direct Method Access", () => {
    it("fetchItems works directly", async () => {
      const handler = createSyncServer<TestItem, TestQuery>({
        fetch: (query) => mockItems.slice(0, query.limit),
      });

      const items = await handler.fetchItems({ page: 1, limit: 2 });

      expect(items).toEqual(mockItems.slice(0, 2));
    });

    it("fetchItems throws when not configured", async () => {
      const handler = createSyncServer<TestItem, TestQuery>({});

      await expect(handler.fetchItems({ page: 1, limit: 10 })).rejects.toThrow(
        "Fetch handler not configured",
      );
    });

    it("processChanges works directly", async () => {
      const handler = createSyncServer<TestItem>({
        create: () => serverSyncSuccess({ newId: "new-1" }),
        update: () => serverSyncSuccess(),
      });

      const results = await handler.processChanges([
        { id: "temp-1", type: "create", data: { id: "temp-1", name: "New" } },
        { id: "1", type: "update", data: { id: "1", name: "Updated" } },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe("success");
      expect(results[1].status).toBe("success");
    });

    it("processChangesWithStats returns categorized results", async () => {
      const handler = createSyncServer<TestItem>({
        create: (data) =>
          data.name === "fail" ? serverSyncError("Failed") : serverSyncSuccess({ newId: data.id }),
      });

      const batchResult = await handler.processChangesWithStats([
        { id: "1", type: "create", data: { id: "1", name: "success" } },
        { id: "2", type: "create", data: { id: "2", name: "fail" } },
      ]);

      expect(batchResult.results).toHaveLength(2);
      expect(batchResult.successful).toHaveLength(1);
      expect(batchResult.failed).toHaveLength(1);
      expect(batchResult.allSucceeded).toBe(false);
      expect(batchResult.anySucceeded).toBe(true);
      expect(batchResult.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
    });

    it("handlers object exposes individual handlers", () => {
      const config: ServerSyncHandlerConfig<TestItem, TestQuery> = {
        fetch: () => mockItems,
        create: () => serverSyncSuccess(),
        update: () => serverSyncSuccess(),
        delete: () => serverSyncSuccess(),
      };

      const handler = createSyncServer<TestItem, TestQuery>(config);

      expect(handler.handlers.fetch).toBe(config.fetch);
      expect(handler.handlers.create).toBe(config.create);
      expect(handler.handlers.update).toBe(config.update);
      expect(handler.handlers.delete).toBe(config.delete);
    });
  });

  describe("Response Headers", () => {
    it("returns JSON content type", async () => {
      const handler = createSyncServer<TestItem, TestQuery>({
        fetch: () => mockItems,
      });
      const request = createRequest<TestItem, TestQuery>({ query: { page: 1, limit: 10 } });

      const response = await handler.handler(request);

      expect(response.headers.get("Content-Type")).toBe("application/json");
    });

    it("returns JSON content type on errors", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = new Request("http://localhost/api/items", { method: "GET" });

      const response = await handler.handler(request);

      expect(response.headers.get("Content-Type")).toBe("application/json");
    });
  });

  describe("Edge Cases", () => {
    it("handles empty changes array", async () => {
      const handler = createSyncServer<TestItem>({});
      const request = createRequest<TestItem, unknown>({ changes: [] });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.syncResults).toEqual([]);
    });

    it("handles null query value", async () => {
      const handler = createSyncServer<TestItem, TestQuery>({
        fetch: () => mockItems,
      });
      const request = new Request("http://localhost/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: null }),
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Request body must contain 'query' and/or 'changes'");
    });

    it("handles sync return values (not async)", async () => {
      const handler = createSyncServer<TestItem>({
        create: () => serverSyncSuccess({ newId: "sync-new" }),
        update: () => serverSyncSuccess(),
        delete: () => serverSyncSuccess(),
      });
      const request = createRequest<TestItem, unknown>({
        changes: [
          { id: "1", type: "create", data: { id: "1", name: "New" } },
          { id: "2", type: "update", data: { id: "2", name: "Updated" } },
          { id: "3", type: "delete", data: { id: "3", name: "Deleted" } },
        ],
      });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults).toHaveLength(3);
      expect(body.syncResults.every((r: { status: string }) => r.status === "success")).toBe(true);
    });

    it("handles large batch of changes", async () => {
      const handler = createSyncServer<TestItem>({
        create: (data) => serverSyncSuccess({ newId: `new-${data.id}` }),
      });

      const changes = Array.from({ length: 100 }, (_, i) => ({
        id: `temp-${i}`,
        type: "create" as const,
        data: { id: `temp-${i}`, name: `Item ${i}` },
      }));

      const request = createRequest<TestItem, unknown>({ changes });

      const response = await handler.handler(request);
      const body = await response.json();

      expect(body.syncResults).toHaveLength(100);
      expect(body.syncResults.every((r: { status: string }) => r.status === "success")).toBe(true);
    });
  });
});
