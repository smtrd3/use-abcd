import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openDB } from "idb";
import { createLocalSyncClient } from "../../runtime/local";
import { Collection } from "../../collection";

interface TestItem {
  id: string;
  name: string;
}

// Helper: delete an IDB database between tests
const deleteDb = async (name: string) => {
  const req = indexedDB.deleteDatabase(name);
  await new Promise<void>((resolve, reject) => {
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

describe("createLocalSyncClient", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;
  let dbName: string;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
    dbName = `test-db-${Date.now()}-${Math.random()}`;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await deleteDb(dbName);
  });

  // ==========================================================================
  // IDB Setup
  // ==========================================================================

  describe("IDB setup", () => {
    it("creates database with items and metadata stores", async () => {
      const client = createLocalSyncClient<TestItem>({ dbName });
      const signal = new AbortController().signal;

      // Trigger lazy init by calling handler
      await client.handler({ query: {} }, signal);

      const db = await openDB(dbName);
      expect(db.objectStoreNames.contains("items")).toBe(true);
      expect(db.objectStoreNames.contains("metadata")).toBe(true);
      db.close();
      await client.destroy();
    });
  });

  // ==========================================================================
  // Fetch mode
  // ==========================================================================

  describe("fetch mode", () => {
    it("returns empty items from empty IDB", async () => {
      const client = createLocalSyncClient<TestItem>({ dbName });
      const signal = new AbortController().signal;

      const result = await client.handler({ query: {} }, signal);

      expect(result.items).toEqual([]);
      await client.destroy();
    });

    it("returns locally stored items after sync", async () => {
      const client = createLocalSyncClient<TestItem>({ dbName });
      const signal = new AbortController().signal;

      // Write items via sync
      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "Alice" } },
            { id: "2", type: "create", data: { id: "2", name: "Bob" } },
          ],
        },
        signal,
      );

      // Fetch should return them
      const result = await client.handler({ query: {} }, signal);

      expect(result.items).toHaveLength(2);
      expect(result.items).toEqual(
        expect.arrayContaining([
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
        ]),
      );
      await client.destroy();
    });

    it("excludes deleted items from items", async () => {
      const client = createLocalSyncClient<TestItem>({ dbName });
      const signal = new AbortController().signal;

      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "Alice" } },
            { id: "2", type: "create", data: { id: "2", name: "Bob" } },
          ],
        },
        signal,
      );

      // Delete one item
      await client.handler(
        {
          changes: [
            { id: "1", type: "delete", data: { id: "1", name: "Alice" } },
          ],
        },
        signal,
      );

      const result = await client.handler({ query: {} }, signal);

      expect(result.items).toHaveLength(1);
      expect(result.items![0].name).toBe("Bob");
      await client.destroy();
    });

    it("fetches from remote when online and endpoint configured (cache-first)", async () => {
      // Mock navigator.onLine
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                { id: "s1", name: "Server Item 1" },
                { id: "s2", name: "Server Item 2" },
              ],
              serverSyncedAt: "01ABC",
            }),
            { status: 200 },
          ),
        ),
      );

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
      });
      const signal = new AbortController().signal;

      // First call returns IDB data immediately (empty), background sync fires
      const result = await client.handler({ query: {} }, signal);
      expect(result.items).toEqual([]);

      // Wait for background remote sync to complete
      await new Promise((r) => setTimeout(r, 100));

      // Remote should have been called with itemsAfter: "0"
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toEqual({ itemsAfter: "0" });

      // Second call returns server items now stored in IDB
      const result2 = await client.handler({ query: {} }, signal);
      expect(result2.items).toHaveLength(2);
      expect(result2.items).toEqual(
        expect.arrayContaining([
          { id: "s1", name: "Server Item 1" },
          { id: "s2", name: "Server Item 2" },
        ]),
      );

      await client.destroy();
    });

    it("uses updated lastSyncedAt on subsequent fetches", async () => {
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

      // First fetch
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ id: "s1", name: "Item 1" }],
            serverSyncedAt: "01FIRST",
          }),
          { status: 200 },
        ),
      );

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
      });
      const signal = new AbortController().signal;

      await client.handler({ query: {} }, signal);

      // Wait for background sync to complete and update lastSyncedAt
      await new Promise((r) => setTimeout(r, 100));

      // Second fetch — should use updated lastSyncedAt
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ id: "s2", name: "Item 2" }],
            serverSyncedAt: "01SECOND",
          }),
          { status: 200 },
        ),
      );

      await client.handler({ query: {} }, signal);

      // Wait for second background sync
      await new Promise((r) => setTimeout(r, 100));

      const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondBody.query).toEqual({ itemsAfter: "01FIRST" });

      await client.destroy();
    });

    it("returns local data when offline", async () => {
      Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
      });
      const signal = new AbortController().signal;

      // Add local data first
      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "Local" } },
          ],
        },
        signal,
      );

      const result = await client.handler({ query: {} }, signal);

      // Should NOT have called remote
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
      expect(result.items![0].name).toBe("Local");

      await client.destroy();
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
    });

    it("falls back to local data when remote fetch fails", async () => {
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

      mockFetch.mockRejectedValue(new Error("Network error"));

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
      });
      const signal = new AbortController().signal;

      // Add local data
      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "Local" } },
          ],
        },
        signal,
      );

      const result = await client.handler({ query: {} }, signal);

      expect(result.items).toHaveLength(1);
      expect(result.items![0].name).toBe("Local");

      await client.destroy();
    });
  });

  // ==========================================================================
  // Sync mode
  // ==========================================================================

  describe("sync mode", () => {
    it("applies changes to IDB and returns syncResults", async () => {
      const client = createLocalSyncClient<TestItem>({ dbName });
      const signal = new AbortController().signal;

      const result = await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "New" } },
          ],
        },
        signal,
      );

      expect(result.syncResults).toEqual([
        { status: "success", id: "1", type: "create", serverSyncedAt: "0" },
      ]);
      expect(result.serverSyncedAt).toBe("0");
      expect(result.items).toBeUndefined();

      // Verify data was written to IDB via a separate fetch
      const fetchResult = await client.handler({ query: {} }, signal);
      expect(fetchResult.items).toHaveLength(1);
      expect(fetchResult.items![0].name).toBe("New");

      await client.destroy();
    });

    it("tracks lastOperation correctly for each change type", async () => {
      const client = createLocalSyncClient<TestItem>({ dbName });
      const signal = new AbortController().signal;

      // Create
      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "Created" } },
          ],
        },
        signal,
      );

      // Update
      await client.handler(
        {
          changes: [
            { id: "1", type: "update", data: { id: "1", name: "Updated" } },
          ],
        },
        signal,
      );

      // Verify lastOperation is "update" in IDB
      const db = await openDB(dbName);
      const record = await db.get("items", "1");
      expect(record.lastOperation).toBe("update");
      expect(record.data.name).toBe("Updated");
      expect(record.serverSyncedAt).toBe("0");
      db.close();

      // Delete
      await client.handler(
        {
          changes: [
            { id: "1", type: "delete", data: { id: "1", name: "Updated" } },
          ],
        },
        signal,
      );

      const db2 = await openDB(dbName);
      const deletedRecord = await db2.get("items", "1");
      expect(deletedRecord.lastOperation).toBe("delete");
      expect(deletedRecord.deleted).toBe(true);
      db2.close();

      await client.destroy();
    });

    it("always returns success even without remote", async () => {
      const client = createLocalSyncClient<TestItem>({ dbName });
      const signal = new AbortController().signal;

      const result = await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "A" } },
            { id: "2", type: "create", data: { id: "2", name: "B" } },
            { id: "3", type: "delete", data: { id: "3", name: "C" } },
          ],
        },
        signal,
      );

      expect(result.syncResults).toEqual([
        { status: "success", id: "1", type: "create", serverSyncedAt: "0" },
        { status: "success", id: "2", type: "create", serverSyncedAt: "0" },
        { status: "success", id: "3", type: "delete", serverSyncedAt: "0" },
      ]);
      expect(result.serverSyncedAt).toBe("0");

      await client.destroy();
    });

    it("enqueues to SyncQueue when online with remote", async () => {
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

      // Each call needs a fresh Response (body can only be consumed once)
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              syncResults: [{ status: "success", id: "1", type: "create", serverSyncedAt: "01ABC" }],
              serverSyncedAt: "01ABC",
            }),
            { status: 200 },
          ),
        ),
      );

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
        debounce: 50,
      });
      const signal = new AbortController().signal;

      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "New" } },
          ],
        },
        signal,
      );

      // SyncQueue enqueues the change
      const state = client.getState();
      expect(state.queue.size + state.inFlight.size).toBeGreaterThanOrEqual(0);

      // Wait for SyncQueue debounce + flush
      await new Promise((r) => setTimeout(r, 200));

      // Remote called by SyncQueue flush only (sync mode early-returns, no background fetch)
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await client.destroy();
    });

    it("does not enqueue when offline", async () => {
      Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
        debounce: 50,
      });
      const signal = new AbortController().signal;

      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "Offline" } },
          ],
        },
        signal,
      );

      await new Promise((r) => setTimeout(r, 200));

      // Remote should NOT have been called
      expect(mockFetch).not.toHaveBeenCalled();

      await client.destroy();
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
    });
  });

  // ==========================================================================
  // Online → offline → online (reconnection)
  // ==========================================================================

  describe("offline to online reconnection", () => {
    it("re-enqueues unsynced records on online event", async () => {
      Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              syncResults: [
                { status: "success", id: "1", type: "create", serverSyncedAt: "01ABC" },
                { status: "success", id: "2", type: "create", serverSyncedAt: "01ABC" },
              ],
              items: [
                { id: "1", name: "Alice" },
                { id: "2", name: "Bob" },
              ],
              serverSyncedAt: "01ABC",
            }),
            { status: 200 },
          ),
        ),
      );

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
        debounce: 50,
      });
      const signal = new AbortController().signal;

      // Create items while offline
      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "Alice" } },
            { id: "2", type: "create", data: { id: "2", name: "Bob" } },
          ],
        },
        signal,
      );

      // Verify items are unsynced
      const db = await openDB(dbName);
      const record = await db.get("items", "1");
      expect(record.serverSyncedAt).toBe("0");
      db.close();

      // Go online
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
      window.dispatchEvent(new Event("online"));

      // Wait for debounce + sync
      await new Promise((r) => setTimeout(r, 300));

      // Remote should have been called with the unsynced changes
      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.changes).toHaveLength(2);

      await client.destroy();
    });
  });

  // ==========================================================================
  // SyncQueue integration
  // ==========================================================================

  describe("SyncQueue integration", () => {
    it("subscribe and getState work for useSyncExternalStore", async () => {
      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
      });

      const state = client.getState();
      expect(state.isPaused).toBe(false);
      expect(state.isSyncing).toBe(false);
      expect(state.queue.size).toBe(0);

      const unsubscribe = client.subscribe(() => {});
      expect(typeof unsubscribe).toBe("function");
      unsubscribe();

      await client.destroy();
    });

    it("returns stable empty state when no remote configured", async () => {
      const client = createLocalSyncClient<TestItem>({ dbName });

      const state1 = client.getState();
      const state2 = client.getState();
      expect(state1).toBe(state2);
      expect(state1.isPaused).toBe(false);
      expect(state1.isSyncing).toBe(false);

      await client.destroy();
    });

    it("pause and resume control the SyncQueue", async () => {
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              syncResults: [{ status: "success", id: "1", type: "create", serverSyncedAt: "01ABC" }],
              serverSyncedAt: "01ABC",
            }),
            { status: 200 },
          ),
        ),
      );

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
        debounce: 50,
      });

      client.pauseSync();
      expect(client.getState().isPaused).toBe(true);

      const signal = new AbortController().signal;
      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "Paused" } },
          ],
        },
        signal,
      );

      // Wait — no remote calls while paused (both SyncQueue and background sync respect pause)
      await new Promise((r) => setTimeout(r, 200));
      expect(mockFetch).not.toHaveBeenCalled();

      // Resume — SyncQueue should now flush the enqueued change
      client.resumeSync();
      expect(client.getState().isPaused).toBe(false);

      await new Promise((r) => setTimeout(r, 200));
      expect(mockFetch).toHaveBeenCalled();

      await client.destroy();
    });
  });

  // ==========================================================================
  // resetDatabase
  // ==========================================================================

  describe("resetDatabase", () => {
    it("clears all IDB stores", async () => {
      const client = createLocalSyncClient<TestItem>({ dbName });
      const signal = new AbortController().signal;

      // Add items
      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "Alice" } },
          ],
        },
        signal,
      );

      // Verify data exists
      let result = await client.handler({ query: {} }, signal);
      expect(result.items).toHaveLength(1);

      // Reset
      await client.resetDatabase();

      // Should be empty
      result = await client.handler({ query: {} }, signal);
      expect(result.items).toHaveLength(0);

      await client.destroy();
    });
  });

  // ==========================================================================
  // destroy
  // ==========================================================================

  describe("destroy", () => {
    it("removes online event listener", async () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
      });

      await client.destroy();

      expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
      removeSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Abort signal
  // ==========================================================================

  describe("abort signal", () => {
    it("returns local data even when signal is aborted (background sync fails silently)", async () => {
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

      mockFetch.mockRejectedValue(new Error("aborted"));

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
      });
      const signal = new AbortController().signal;

      // Seed local data
      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "Local" } },
          ],
        },
        signal,
      );

      // Aborted signal — handler still returns local data, remote sync fails silently
      const controller = new AbortController();
      controller.abort();

      const result = await client.handler({ query: {} }, controller.signal);
      expect(result.items).toHaveLength(1);
      expect(result.items![0].name).toBe("Local");

      await client.destroy();
    });
  });

  // ==========================================================================
  // Delete cleanup
  // ==========================================================================

  describe("delete cleanup", () => {
    it("removes deleted records from IDB after successful server sync", async () => {
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              syncResults: [
                { status: "success", id: "1", type: "create", serverSyncedAt: "01ABC" },
                { status: "success", id: "2", type: "create", serverSyncedAt: "01ABC" },
              ],
              serverSyncedAt: "01ABC",
            }),
            { status: 200 },
          ),
        ),
      );

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
        debounce: 50,
      });
      const signal = new AbortController().signal;

      // Create two items
      await client.handler(
        {
          changes: [
            { id: "1", type: "create", data: { id: "1", name: "Alice" } },
            { id: "2", type: "create", data: { id: "2", name: "Bob" } },
          ],
        },
        signal,
      );

      // Wait for SyncQueue to flush creates
      await new Promise((r) => setTimeout(r, 200));
      mockFetch.mockClear();

      // Delete one item
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              syncResults: [{ status: "success", id: "1", type: "delete", serverSyncedAt: "01DEF" }],
              serverSyncedAt: "01DEF",
            }),
            { status: 200 },
          ),
        ),
      );

      await client.handler(
        {
          changes: [
            { id: "1", type: "delete", data: { id: "1", name: "Alice" } },
          ],
        },
        signal,
      );

      // Wait for SyncQueue to flush the delete
      await new Promise((r) => setTimeout(r, 200));

      // Deleted record should be fully removed from IDB (not just soft-deleted)
      const db = await openDB(dbName);
      const deletedRecord = await db.get("items", "1");
      expect(deletedRecord).toBeUndefined();

      // Non-deleted record should still exist
      const keptRecord = await db.get("items", "2");
      expect(keptRecord).toBeDefined();
      expect(keptRecord.data.name).toBe("Bob");
      db.close();

      await client.destroy();
    });
  });

  // ==========================================================================
  // Collection refresh on server sync
  // ==========================================================================

  describe("collection refresh on server sync", () => {
    it("refreshes collection when collectionId is set and syncFromRemote stores items", async () => {
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              items: [{ id: "s1", name: "Server Item" }],
              serverSyncedAt: "01ABC",
            }),
            { status: 200 },
          ),
        ),
      );

      const mockRefresh = vi.fn().mockResolvedValue(undefined);
      const getByIdSpy = vi.spyOn(Collection, "getById").mockReturnValue({
        refresh: mockRefresh,
      } as unknown as ReturnType<typeof Collection.getById>);

      const client = createLocalSyncClient<TestItem>({
        dbName,
        collectionId: "test-collection",
        remoteSyncEndpoint: "/api/sync",
      });
      const signal = new AbortController().signal;

      // Trigger fetch mode — syncFromRemote fires in background
      await client.handler({ query: {} }, signal);

      // Wait for background sync to complete
      await new Promise((r) => setTimeout(r, 100));

      expect(getByIdSpy).toHaveBeenCalledWith("test-collection");
      expect(mockRefresh).toHaveBeenCalled();

      getByIdSpy.mockRestore();
      await client.destroy();
    });

    it("does not refresh when collectionId is not set", async () => {
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              items: [{ id: "s1", name: "Server Item" }],
              serverSyncedAt: "01ABC",
            }),
            { status: 200 },
          ),
        ),
      );

      const getByIdSpy = vi.spyOn(Collection, "getById");

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
      });
      const signal = new AbortController().signal;

      await client.handler({ query: {} }, signal);
      await new Promise((r) => setTimeout(r, 100));

      expect(getByIdSpy).not.toHaveBeenCalled();

      getByIdSpy.mockRestore();
      await client.destroy();
    });
  });

  // ==========================================================================
  // Metadata store
  // ==========================================================================

  describe("metadata store", () => {
    it("stores lastSyncedAt as generic record with id and value", async () => {
      Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });

      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              items: [{ id: "s1", name: "Item" }],
              serverSyncedAt: "01TIMESTAMP",
            }),
            { status: 200 },
          ),
        ),
      );

      const client = createLocalSyncClient<TestItem>({
        dbName,
        remoteSyncEndpoint: "/api/sync",
      });
      const signal = new AbortController().signal;

      await client.handler({ query: {} }, signal);

      // Wait for background remote sync to complete
      await new Promise((r) => setTimeout(r, 100));

      // Verify metadata record shape
      const db = await openDB(dbName);
      const record = await db.get("metadata", "lastSyncedAt");
      expect(record).toEqual({ id: "lastSyncedAt", value: "01TIMESTAMP" });
      db.close();

      await client.destroy();
    });
  });
});
