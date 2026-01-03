/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse, delay } from "msw";
import { Collection } from "./collection";
import { createSyncServer, serverSyncSuccess, serverSyncError } from "./runtime/server";
import { createSyncClientFromEndpoint } from "./runtime";
import type { Config } from "./types";
import type { SyncRequestBody } from "./runtime";

// ============================================================================
// Test Types
// ============================================================================

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface UserQuery {
  page: number;
  limit: number;
  search?: string;
}

// ============================================================================
// In-Memory Database for Tests
// ============================================================================

function createDatabase() {
  let users: User[] = [];
  let nextId = 1;

  const reset = () => {
    users = [
      { id: "1", name: "John Doe", email: "john@example.com", role: "admin" },
      { id: "2", name: "Jane Smith", email: "jane@example.com", role: "user" },
      { id: "3", name: "Bob Johnson", email: "bob@example.com", role: "user" },
    ];
    nextId = 4;
  };

  reset();

  return {
    getAll: () => [...users],
    get: (id: string) => users.find((u) => u.id === id),
    query: (query: UserQuery) => {
      let filtered = [...users];

      if (query.search) {
        const searchLower = query.search.toLowerCase();
        filtered = filtered.filter(
          (u) =>
            u.name.toLowerCase().includes(searchLower) ||
            u.email.toLowerCase().includes(searchLower),
        );
      }

      const start = (query.page - 1) * query.limit;
      return filtered.slice(start, start + query.limit);
    },
    create: (data: User) => {
      const id = String(nextId++);
      const user = { ...data, id };
      users.push(user);
      return user;
    },
    update: (id: string, data: User) => {
      const index = users.findIndex((u) => u.id === id);
      if (index === -1) return null;
      users[index] = { ...users[index], ...data, id };
      return users[index];
    },
    delete: (id: string) => {
      const index = users.findIndex((u) => u.id === id);
      if (index === -1) return false;
      users.splice(index, 1);
      return true;
    },
    reset,
  };
}

// ============================================================================
// Test Setup
// ============================================================================

describe("Collection E2E with MSW and createSyncServer", () => {
  const db = createDatabase();
  let server: ReturnType<typeof setupServer>;

  // Helper to create sync server with current db state
  const createSyncServerInstance = () =>
    createSyncServer<User, UserQuery>({
      fetch: (query, _ctx) => db.query(query),
      create: (data, _ctx) => {
        const user = db.create(data);
        return serverSyncSuccess({ newId: user.id });
      },
      update: (id, data, _ctx) => {
        const user = db.update(id, data);
        if (!user) return serverSyncError("User not found");
        return serverSyncSuccess();
      },
      delete: (id, _data, _ctx) => {
        const success = db.delete(id);
        if (!success) return serverSyncError("User not found");
        return serverSyncSuccess();
      },
    });

  beforeAll(() => {
    // Set up MSW server with dynamic handler
    server = setupServer(
      http.post("/api/users", async ({ request }) => {
        const syncServer = createSyncServerInstance();
        const response = await syncServer.handler(request);
        const body = await response.json();
        return HttpResponse.json(body, { status: response.status });
      }),
    );

    server.listen({ onUnhandledRequest: "error" });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    db.reset();
    Collection.clearAll();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  // Helper to wait for a condition using vi.waitFor with expect
  const waitFor = (condition: () => boolean, options?: { timeout?: number }) =>
    vi.waitFor(
      () => {
        expect(condition()).toBe(true);
      },
      { timeout: options?.timeout ?? 5000 },
    );

  // Helper to create a collection config
  const createConfig = (overrides?: Partial<Config<User, UserQuery>>): Config<User, UserQuery> => {
    const { onFetch, onSync } = createSyncClientFromEndpoint<User, UserQuery>("/api/users");

    return {
      id: `users-${Date.now()}-${Math.random()}`,
      initialContext: { page: 1, limit: 10 },
      getId: (user) => user.id,
      onFetch,
      onSync,
      syncDebounce: 50, // Faster for tests
      ...overrides,
    };
  };

  describe("Initial Fetch", () => {
    it("fetches initial data from server on creation", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      expect(collection.loading).toBe(true);

      await waitFor(() => !collection.loading);

      expect(collection.items.size).toBe(3);
      expect(collection.items.get("1")?.name).toBe("John Doe");
      expect(collection.items.get("2")?.name).toBe("Jane Smith");
      expect(collection.items.get("3")?.name).toBe("Bob Johnson");
    });

    it("handles fetch with pagination", async () => {
      const config = createConfig({
        initialContext: { page: 1, limit: 2 },
      });
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      expect(collection.items.size).toBe(2);
      expect(collection.items.has("1")).toBe(true);
      expect(collection.items.has("2")).toBe(true);
      expect(collection.items.has("3")).toBe(false);
    });

    it("handles fetch with search filter", async () => {
      const config = createConfig({
        initialContext: { page: 1, limit: 10, search: "john" },
      });
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      expect(collection.items.size).toBe(2); // John Doe and Bob Johnson
    });
  });

  describe("Create Operations", () => {
    it("creates item optimistically and syncs to server", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      const tempId = `temp-${Date.now()}`;
      const newUser: User = {
        id: tempId,
        name: "New User",
        email: "new@example.com",
        role: "user",
      };

      collection.create(newUser);

      // Item should exist locally immediately
      expect(collection.items.has(tempId)).toBe(true);
      expect(collection.items.get(tempId)?.name).toBe("New User");

      // Should have pending status
      const status = collection.getItemStatus(tempId);
      expect(status?.type).toBe("create");

      // Wait for sync to complete
      await waitFor(() => !collection.syncing, { timeout: 5000 });

      // After sync, ID should be remapped to server-generated ID
      await waitFor(() => !collection.items.has(tempId), { timeout: 5000 });

      // Item should exist with new server ID
      expect(collection.items.has("4")).toBe(true);
      expect(collection.items.get("4")?.name).toBe("New User");

      // Verify server has the item
      expect(db.get("4")?.name).toBe("New User");
    });

    it("handles multiple creates in batch", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      const tempIds = ["temp-0", "temp-1", "temp-2"];

      // Create multiple items quickly
      for (let i = 0; i < 3; i++) {
        collection.create({
          id: tempIds[i],
          name: `User ${i}`,
          email: `user${i}@example.com`,
          role: "user",
        });
      }

      // All should exist locally with temp IDs
      expect(collection.items.size).toBe(6); // 3 existing + 3 new
      for (const tempId of tempIds) {
        expect(collection.items.has(tempId)).toBe(true);
      }

      // Wait for sync
      await waitFor(() => !collection.syncing, { timeout: 5000 });

      // Wait for all items to be synced to server
      await waitFor(() => db.getAll().length === 6, { timeout: 5000 });

      // All should be synced
      expect(db.getAll().length).toBe(6);

      // Wait for ID remapping to complete - all temp IDs should be removed
      await waitFor(() => !tempIds.some((id) => collection.items.has(id)), { timeout: 5000 });

      // Verify temp IDs are no longer in the collection
      for (const tempId of tempIds) {
        expect(collection.items.has(tempId)).toBe(false);
      }

      // Verify new server-assigned IDs exist (4, 5, 6)
      const expectedServerIds = ["4", "5", "6"];
      for (const serverId of expectedServerIds) {
        expect(collection.items.has(serverId)).toBe(true);
      }

      // Verify the data was preserved after ID remapping
      const serverItems = expectedServerIds.map((id) => collection.items.get(id));
      const names = serverItems.map((item) => item?.name).sort();
      expect(names).toEqual(["User 0", "User 1", "User 2"]);

      const emails = serverItems.map((item) => item?.email).sort();
      expect(emails).toEqual(["user0@example.com", "user1@example.com", "user2@example.com"]);
    });
  });

  describe("Update Operations", () => {
    it("updates item optimistically and syncs to server", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      collection.update("1", (draft) => {
        draft.name = "John Updated";
      });

      // Item should be updated locally immediately
      expect(collection.items.get("1")?.name).toBe("John Updated");

      // Should have pending status
      const status = collection.getItemStatus("1");
      expect(status?.type).toBe("update");

      // Wait for sync
      await waitFor(() => !collection.syncing, { timeout: 5000 });

      // Wait a bit more for server to process
      await new Promise((r) => setTimeout(r, 100));

      // Verify server has the update
      expect(db.get("1")?.name).toBe("John Updated");
    });

    it("handles rapid updates (debouncing)", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      // Rapidly update the same item
      for (let i = 0; i < 5; i++) {
        collection.update("1", (draft) => {
          draft.name = `Name ${i}`;
        });
      }

      // Final local state should reflect last update
      expect(collection.items.get("1")?.name).toBe("Name 4");

      // Wait for sync
      await waitFor(() => !collection.syncing, { timeout: 5000 });

      // Wait a bit more for server to process
      await new Promise((r) => setTimeout(r, 100));

      // Server should have the final value
      expect(db.get("1")?.name).toBe("Name 4");
    });
  });

  describe("Delete Operations", () => {
    it("deletes item optimistically and syncs to server", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      const initialSize = collection.items.size;
      collection.remove("1");

      // Item should be removed locally immediately
      expect(collection.items.size).toBe(initialSize - 1);
      expect(collection.items.has("1")).toBe(false);

      // Wait for sync
      await waitFor(() => !collection.syncing, { timeout: 5000 });

      // Wait a bit more for server to process
      await new Promise((r) => setTimeout(r, 100));

      // Verify server has deleted the item
      expect(db.get("1")).toBeUndefined();
    });
  });

  describe("Context Changes and Refetching", () => {
    it("refetches when context changes", async () => {
      const config = createConfig({
        initialContext: { page: 1, limit: 2 },
      });
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);
      expect(collection.items.size).toBe(2);

      // Change to page 2
      collection.setContext((draft) => {
        draft.page = 2;
      });

      // Wait for refetch to start and complete
      await new Promise((r) => setTimeout(r, 100));
      await waitFor(() => !collection.loading, { timeout: 5000 });

      // Should have different items from page 2
      expect(collection.items.size).toBe(1);
      expect(collection.items.has("3")).toBe(true);
    });

    it("preserves pending changes during refetch", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      // Create a new item
      const tempId = `temp-${Date.now()}`;
      collection.create({
        id: tempId,
        name: "Pending User",
        email: "pending@example.com",
        role: "user",
      });

      // Before sync completes, trigger a refetch
      await collection.refresh();

      // The pending item should still be in the collection
      expect(
        collection.items.has(tempId) || collection.items.get("4")?.name === "Pending User",
      ).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("handles server errors gracefully", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      // Override the handler to return errors for creates
      server.use(
        http.post("/api/users", async ({ request }) => {
          const body = (await request.json()) as SyncRequestBody<User, UserQuery>;
          if (body.changes) {
            return HttpResponse.json({
              syncResults: body.changes.map((c) => ({
                id: c.id,
                status: "error",
                error: "Server error",
              })),
            });
          }
          // For fetch requests, delegate to the real handler
          const syncServer = createSyncServerInstance();
          const response = await syncServer.handler(request);
          const responseBody = await response.json();
          return HttpResponse.json(responseBody, { status: response.status });
        }),
      );

      const tempId = `temp-${Date.now()}`;
      collection.create({
        id: tempId,
        name: "Will Fail",
        email: "fail@example.com",
        role: "user",
      });

      // Wait for sync attempt
      await waitFor(
        () => {
          const status = collection.getItemStatus(tempId);
          return status?.status === "error" || status?.status === "pending";
        },
        { timeout: 5000 },
      );

      // The item should still exist locally
      expect(collection.items.has(tempId)).toBe(true);

      // Should have error status
      const status = collection.getItemStatus(tempId);
      expect(status?.status === "error" || status?.status === "pending").toBe(true);
    });

    it("retries failed operations", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      let attemptCount = 0;

      server.use(
        http.post("/api/users", async ({ request }) => {
          const body = (await request.json()) as SyncRequestBody<User, UserQuery>;
          if (body.changes) {
            attemptCount++;
            if (attemptCount < 3) {
              return HttpResponse.json({
                syncResults: body.changes.map((c) => ({
                  id: c.id,
                  status: "error",
                  error: "Temporary error",
                })),
              });
            }
            // Third attempt succeeds
            return HttpResponse.json({
              syncResults: body.changes.map((c) => ({
                id: c.id,
                status: "success",
                newId: c.type === "create" ? "999" : undefined,
              })),
            });
          }
          // For fetch requests
          const syncServer = createSyncServerInstance();
          const response = await syncServer.handler(request);
          const responseBody = await response.json();
          return HttpResponse.json(responseBody, { status: response.status });
        }),
      );

      const tempId = `temp-${Date.now()}`;
      collection.create({
        id: tempId,
        name: "Will Eventually Succeed",
        email: "retry@example.com",
        role: "user",
      });

      // Wait for eventual success (after retries)
      await waitFor(() => attemptCount >= 3, { timeout: 10000 });

      // Should have made multiple attempts
      expect(attemptCount).toBeGreaterThanOrEqual(3);
    }, 15000);
  });

  describe("Sync Queue Controls", () => {
    it("pauses and resumes sync", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      // Pause sync
      collection.pauseSync();

      // Create an item
      const tempId = `temp-${Date.now()}`;
      collection.create({
        id: tempId,
        name: "Paused User",
        email: "paused@example.com",
        role: "user",
      });

      // Wait a bit to ensure no sync happens
      await new Promise((r) => setTimeout(r, 300));

      // Item should exist locally but not on server
      expect(collection.items.has(tempId)).toBe(true);
      expect(db.get(tempId)).toBeUndefined();
      expect(db.getAll().length).toBe(3); // Original 3 items

      // Resume sync
      collection.resumeSync();

      // Wait for sync to complete
      await waitFor(() => db.getAll().length === 4, { timeout: 5000 });

      // Now should be on server
      expect(db.getAll().length).toBe(4);
    }, 10000);
  });

  describe("Subscription and State Updates", () => {
    it("notifies subscribers on state changes", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      const subscriber = vi.fn();
      const unsubscribe = collection.subscribe(subscriber);

      await waitFor(() => !collection.loading);

      // Should have been called during initial fetch
      expect(subscriber).toHaveBeenCalled();

      const callCountAfterFetch = subscriber.mock.calls.length;

      // Create an item
      collection.create({
        id: `temp-${Date.now()}`,
        name: "Subscriber Test",
        email: "sub@example.com",
        role: "user",
      });

      // Should have been called for the create
      expect(subscriber.mock.calls.length).toBeGreaterThan(callCountAfterFetch);

      unsubscribe();

      const callCountAfterUnsubscribe = subscriber.mock.calls.length;

      // Create another item
      collection.create({
        id: `temp-${Date.now() + 1}`,
        name: "After Unsub",
        email: "after@example.com",
        role: "user",
      });

      // Should not be called after unsubscribe
      expect(subscriber.mock.calls.length).toBe(callCountAfterUnsubscribe);
    });

    it("provides correct state via getState()", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      const initialState = collection.getState();
      expect(initialState.loading).toBe(true);
      expect(initialState.items.size).toBe(0);

      await waitFor(() => !collection.loading);

      const loadedState = collection.getState();
      expect(loadedState.loading).toBe(false);
      expect(loadedState.items.size).toBe(3);
    });
  });

  describe("Item Helper", () => {
    it("provides Item instances for individual items", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      const item = collection.getItem("1");

      expect(item.data).toEqual({
        id: "1",
        name: "John Doe",
        email: "john@example.com",
        role: "admin",
      });

      item.update((draft) => {
        draft.name = "John Updated via Item";
      });

      expect(collection.items.get("1")?.name).toBe("John Updated via Item");
    });

    it("caches Item instances", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);

      const item1 = collection.getItem("1");
      const item2 = collection.getItem("1");

      expect(item1).toBe(item2); // Same instance
    });
  });

  describe("Collection Caching", () => {
    it("returns same instance for same config id", async () => {
      const config1 = createConfig({ id: "shared-collection" });
      const config2 = { ...config1, id: "shared-collection" };

      const collection1 = Collection.get(config1);
      const collection2 = Collection.get(config2);

      expect(collection1).toBe(collection2);
    });

    it("clears specific collection from cache", async () => {
      const config = createConfig({ id: "clearable" });
      const collection1 = Collection.get(config);

      Collection.clear("clearable");

      const collection2 = Collection.get(config);
      expect(collection1).not.toBe(collection2);
    });

    it("clears all collections from cache", async () => {
      const config1 = createConfig({ id: "collection-1" });
      const config2 = createConfig({ id: "collection-2" });

      const c1 = Collection.get(config1);
      const c2 = Collection.get(config2);

      Collection.clearAll();

      const c1New = Collection.get(config1);
      const c2New = Collection.get(config2);

      expect(c1).not.toBe(c1New);
      expect(c2).not.toBe(c2New);
    });
  });

  describe("Full CRUD Workflow", () => {
    it("handles complete create-read-update-delete workflow", async () => {
      const config = createConfig();
      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);
      expect(collection.items.size).toBe(3);

      // CREATE
      const tempId = `temp-${Date.now()}`;
      collection.create({
        id: tempId,
        name: "CRUD Test User",
        email: "crud@example.com",
        role: "user",
      });

      expect(collection.items.has(tempId)).toBe(true);
      await waitFor(() => !collection.syncing, { timeout: 5000 });

      // Wait for ID remap
      await waitFor(() => collection.items.has("4"), { timeout: 5000 });

      // READ
      const user = collection.items.get("4");
      expect(user?.name).toBe("CRUD Test User");
      expect(db.get("4")?.name).toBe("CRUD Test User");

      // UPDATE
      collection.update("4", (draft) => {
        draft.name = "CRUD Test User Updated";
        draft.role = "admin";
      });

      expect(collection.items.get("4")?.name).toBe("CRUD Test User Updated");
      await waitFor(() => !collection.syncing, { timeout: 5000 });

      // Wait for server to process
      await new Promise((r) => setTimeout(r, 100));
      expect(db.get("4")?.name).toBe("CRUD Test User Updated");

      // DELETE
      collection.remove("4");
      expect(collection.items.has("4")).toBe(false);
      await waitFor(() => !collection.syncing, { timeout: 5000 });

      // Wait for server to process
      await new Promise((r) => setTimeout(r, 100));
      expect(db.get("4")).toBeUndefined();

      // Final state should have original 3 items
      await collection.refresh();
      await waitFor(() => !collection.loading);
      expect(collection.items.size).toBe(3);
    });
  });

  describe("Offline-First Mode (No onSync)", () => {
    it("works without onSync handler (pure offline mode)", async () => {
      const { onFetch } = createSyncClientFromEndpoint<User, UserQuery>("/api/users");

      const config: Config<User, UserQuery> = {
        id: `offline-${Date.now()}`,
        initialContext: { page: 1, limit: 10 },
        getId: (user) => user.id,
        onFetch,
        // No onSync - pure offline mode
        syncDebounce: 50,
      };

      const collection = Collection.get(config);

      await waitFor(() => !collection.loading);
      expect(collection.items.size).toBe(3);

      // Create works locally
      const tempId = `temp-${Date.now()}`;
      collection.create({
        id: tempId,
        name: "Offline User",
        email: "offline@example.com",
        role: "user",
      });

      expect(collection.items.has(tempId)).toBe(true);

      // Wait for "sync" (which just succeeds locally)
      await waitFor(() => !collection.syncing, { timeout: 5000 });

      // Item still exists locally (no server sync occurred)
      expect(collection.items.has(tempId)).toBe(true);

      // Server doesn't have it
      expect(db.get(tempId)).toBeUndefined();
    });
  });

  describe("Network Delay Handling", () => {
    it("handles slow network responses", async () => {
      server.use(
        http.post("/api/users", async ({ request }) => {
          // Simulate slow network
          await delay(500);
          const syncServer = createSyncServerInstance();
          const response = await syncServer.handler(request);
          const body = await response.json();
          return HttpResponse.json(body, { status: response.status });
        }),
      );

      const config = createConfig();
      const collection = Collection.get(config);

      // Should be loading
      expect(collection.loading).toBe(true);

      await waitFor(() => !collection.loading, { timeout: 10000 });

      expect(collection.items.size).toBe(3);
    });
  });
});
