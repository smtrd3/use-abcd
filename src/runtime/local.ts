import { useSyncExternalStore } from "react";
import { openDB, type IDBPDatabase } from "idb";
import { filter, map, forEach, size } from "lodash-es";
import { SyncQueue } from "../sync-queue";
import { Collection } from "../collection";
import { createSyncClient } from "./client";
import type { Change, Result, SyncResponse, SyncQueueState } from "../types";
import type { LocalRecord, MetadataRecord, LocalSyncClientConfig } from "./types";

export type { LocalSyncClientConfig };

// ============================================================================
// createLocalSyncClient
// ============================================================================

export function createLocalSyncClient<T extends { id: string }>(config: LocalSyncClientConfig) {
  let dbPromise: Promise<IDBPDatabase> | null = null;

  // ---------- IDB helpers ----------

  const getDb = (): Promise<IDBPDatabase> => {
    if (!dbPromise) {
      dbPromise = openDB(config.dbName, config.version ?? 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("items")) {
            db.createObjectStore("items", { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains("metadata")) {
            db.createObjectStore("metadata", { keyPath: "id" });
          }
        },
      });
    }
    return dbPromise;
  };

  const getLastSyncedAt = async (): Promise<string> => {
    const db = await getDb();
    const record = (await db.get("metadata", "lastSyncedAt")) as MetadataRecord | undefined;
    return (record?.value as string) ?? "0";
  };

  const setLastSyncedAt = async (value: string): Promise<void> => {
    const db = await getDb();
    await db.put("metadata", { id: "lastSyncedAt", value } satisfies MetadataRecord);
  };

  const getAllNonDeleted = async (): Promise<T[]> => {
    const db = await getDb();
    const records: LocalRecord<T>[] = await db.getAll("items");
    return map(
      filter(records, (r) => !r.deleted),
      (r) => r.data,
    );
  };

  const applyChanges = async (changes: Change<T>[]): Promise<void> => {
    const db = await getDb();
    const tx = db.transaction("items", "readwrite");
    const store = tx.objectStore("items");

    for (const change of changes) {
      const record: LocalRecord<T> = {
        id: change.id,
        data: change.data,
        serverSyncedAt: "0",
        deleted: change.type === "delete",
        lastOperation: change.type,
      };
      await store.put(record);
    }

    await tx.done;
  };

  const storeServerItems = async (items: T[], serverSyncedAt: string): Promise<void> => {
    const db = await getDb();
    const tx = db.transaction("items", "readwrite");
    const store = tx.objectStore("items");

    for (const item of items) {
      const record: LocalRecord<T> = {
        id: item.id,
        data: item,
        serverSyncedAt,
        deleted: false,
        lastOperation: "create",
      };
      await store.put(record);
    }

    await tx.done;
  };

  const markSynced = async (ids: string[], serverSyncedAt: string): Promise<void> => {
    const db = await getDb();
    const tx = db.transaction("items", "readwrite");
    const store = tx.objectStore("items");

    for (const id of ids) {
      const record = (await store.get(id)) as LocalRecord<T> | undefined;
      if (record) {
        await store.put({ ...record, serverSyncedAt });
      }
    }

    await tx.done;
  };

  const getUnsyncedRecords = async (): Promise<LocalRecord<T>[]> => {
    const db = await getDb();
    const records: LocalRecord<T>[] = await db.getAll("items");
    return filter(records, (r) => r.serverSyncedAt === "0");
  };

  const removeDeletedRecords = async (ids: string[]): Promise<void> => {
    const db = await getDb();
    const tx = db.transaction("items", "readwrite");
    forEach(ids, (id) => tx.store.delete(id));
    await tx.done;
  };

  const clearAll = async (): Promise<void> => {
    const db = await getDb();
    const tx = db.transaction(["items", "metadata"], "readwrite");
    await tx.objectStore("items").clear();
    await tx.objectStore("metadata").clear();
    await tx.done;
  };

  // ---------- Remote client ----------

  const remoteClient = config.remoteSyncEndpoint
    ? createSyncClient<T, { itemsAfter: string }>({
        endpoint: config.remoteSyncEndpoint,
        headers: config.headers,
        scope: config.scope,
      })
    : null;

  // ---------- Collection refresh ----------

  const refreshCollection = () => {
    if (!config.collectionId) return;
    Collection.getById(config.collectionId)?.refresh();
  };

  // ---------- SyncQueue (IDB → server) ----------

  const syncToServer = async (
    changes: Change<T>[],
    signal: AbortSignal,
  ): Promise<SyncResponse<T>> => {
    const lastSyncedAt = await getLastSyncedAt();

    const response = await remoteClient!({ query: { itemsAfter: lastSyncedAt }, changes }, signal);

    // Build syncResults — use response or default to all success
    const syncResults: Result[] =
      response.syncResults ??
      map(changes, (c) => ({
        status: "success" as const,
        id: c.id,
        type: c.type,
        serverSyncedAt: response.serverSyncedAt,
      }));

    // Store returned items in IDB with server timestamp
    if (size(response.items) > 0) {
      await storeServerItems(response.items, response.serverSyncedAt);
    }

    // Mark successful non-delete changes not in response.items as synced
    const returnedIds = new Set(map(response.items ?? [], (r) => r.id));
    const extraIds = map(
      filter(
        syncResults,
        (r) => r.status === "success" && r.type !== "delete" && !returnedIds.has(r.id),
      ),
      (r) => r.id,
    );
    if (size(extraIds) > 0) {
      await markSynced(extraIds, response.serverSyncedAt);
    }

    await setLastSyncedAt(response.serverSyncedAt);

    // Remove successfully deleted items from IDB
    const successfulDeleteIds = map(
      filter(syncResults, (r) => r.type === "delete" && r.status === "success"),
      (r) => r.id,
    );
    if (size(successfulDeleteIds) > 0) {
      await removeDeletedRecords(successfulDeleteIds);
    }

    return { items: response.items, syncResults, serverSyncedAt: response.serverSyncedAt };
  };

  const syncQueue = remoteClient
    ? new SyncQueue<T>({
        debounce: config.debounce ?? 1000,
        maxRetries: config.maxRetries ?? 3,
        batchSize: config.batchSize,
        onSync: (changes, _ctx, signal) => syncToServer(changes, signal),
        onServerItems: () => refreshCollection(),
      })
    : null;

  // ---------- Online/offline detection ----------

  const onOnline = async () => {
    if (!syncQueue) return;
    const unsynced = await getUnsyncedRecords();
    forEach(unsynced, (record) => {
      syncQueue.enqueue({
        id: record.id,
        type: record.lastOperation,
        data: record.data,
      });
    });
  };

  if (typeof window !== "undefined" && remoteClient) {
    window.addEventListener("online", onOnline);
  }

  // ---------- Handler (CrudHandler compatible) ----------

  const syncFromRemote = async (signal: AbortSignal) => {
    if (!remoteClient || typeof navigator === "undefined" || !navigator.onLine) return;
    if (syncQueue?.getState().isPaused) return;
    const lastSyncedAt = await getLastSyncedAt();
    remoteClient({ query: { itemsAfter: lastSyncedAt } }, signal)
      .then(async (response) => {
        if (size(response.items) > 0) {
          await storeServerItems(response.items, response.serverSyncedAt);
          refreshCollection();
        }
        await setLastSyncedAt(response.serverSyncedAt);
      })
      .catch(() => {
        // Remote fetch failed — local data already returned
      });
  };

  const handler = async (
    params: { query?: unknown; changes?: Change<T>[] },
    signal: AbortSignal,
  ): Promise<SyncResponse<T>> => {
    // Sync mode — write to IDB, enqueue for server sync
    if (size(params.changes) > 0) {
      await applyChanges(params.changes);

      const syncResults: Result[] = map(params.changes, (c) => ({
        status: "success" as const,
        id: c.id,
        type: c.type,
        serverSyncedAt: "0",
      }));

      if (syncQueue && typeof navigator !== "undefined" && navigator.onLine) {
        forEach(params.changes, (change) => syncQueue.enqueue(change));
      }

      return { syncResults, serverSyncedAt: "0" };
    }

    // Fetch mode — return IDB items, trigger background remote sync
    const items = await getAllNonDeleted();
    syncFromRemote(signal);

    return { items, serverSyncedAt: "0" };
  };

  // ---------- Stable empty state ----------

  const emptySyncState: SyncQueueState<T> = {
    queue: new Map(),
    inFlight: new Map(),
    errors: new Map(),
    isPaused: false,
    isSyncing: false,
  };

  // ---------- Return ----------

  return {
    handler,

    // useSyncExternalStore compatible (IDB→server sync state)
    subscribe: syncQueue
      ? (cb: () => void) => syncQueue.subscribe(cb)
      : // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (_cb: () => void) => () => {},
    getState: syncQueue ? () => syncQueue.getState() : () => emptySyncState,

    // SyncQueue controls
    pauseSync: () => syncQueue?.pause(),
    resumeSync: () => syncQueue?.resume(),
    retrySync: (id?: string) => (id ? syncQueue?.retry(id) : syncQueue?.retryAll()),

    resetDatabase: clearAll,

    destroy: async () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
      }
      syncQueue?.destroy();
      if (dbPromise) {
        const db = await dbPromise;
        db.close();
        dbPromise = null;
      }
    },
  };
}

// ============================================================================
// useLocalSyncState hook
// ============================================================================

export function useLocalSyncState<T extends { id: string }>(
  collectionId: string,
  localClient: ReturnType<typeof createLocalSyncClient<T>>,
) {
  const state = useSyncExternalStore(
    localClient.subscribe,
    localClient.getState,
    localClient.getState,
  );

  return {
    // SyncQueue state (IDB→server)
    isSyncing: state.isSyncing,
    isPaused: state.isPaused,
    queue: state.queue,
    inFlight: state.inFlight,
    errors: state.errors,

    // Controls
    pauseSync: localClient.pauseSync,
    resumeSync: localClient.resumeSync,
    retrySync: localClient.retrySync,
    resetDatabase: localClient.resetDatabase,
    refetch: () => {
      Collection.getById(collectionId)?.refresh();
    },
  };
}
