export type JsonValue = string | number | boolean | null | undefined;

export type PlainObject = {
  [key: string]: JsonValue | PlainObject | JsonValue[] | PlainObject[];
};

export type Result = {
  status: "success" | "error";
  error?: string;
};

export type Fn<A, R = void> = (arg: A) => R;

export type Mutator<T> = (draft: T) => void;

export type SyncState = "idle" | "fetching" | "syncing";

export type ItemSyncStatus = "pending" | "syncing" | "success" | "error";

export type ChangeType = "create" | "update" | "delete";

export type Change<T extends object> = {
  id: string;
  type: ChangeType;
  data: T;
};

// Item status computed from SyncQueue state
export type ItemStatus = {
  type: ChangeType;
  status: ItemSyncStatus;
  retries: number;
  error?: string;
} | null;

export type SyncResult = {
  id: string;
  status: "success" | "error";
  error?: string;
  newId?: string; // For create operations: the server-assigned ID to replace the temporary ID
};

// Unified onSync params and result
export type OnSyncParams<T extends object, C, Q = unknown> = {
  changes?: Change<T>[];
  query?: Q;
  signal: AbortSignal;
  context: C;
};

export type OnSyncResult<T extends object, S = unknown> = {
  queryResults: T[];
  syncResults: SyncResult[];
  serverState?: S; // Optional server state (e.g., pagination: totalItems, nextCursor, etc.)
};

// ID mapping from temporary to permanent ID (for create operations)
export type IdMapping = {
  tempId: string;
  newId: string;
};

// Error info for failed sync operations
export type SyncError<T extends object> = {
  error: string;
  retries: number;
  operations: Change<T>[]; // The operations that failed, for manual retry
};

// SyncQueue state (accessible via getState/subscribe)
export type SyncQueueState<T extends object> = {
  queue: Map<string, Change<T>[]>; // pending changes per item (coalesced operations)
  inFlight: Map<string, Change<T>[]>; // currently syncing operations per item
  errors: Map<string, SyncError<T>>; // failed items with retry info and operations
  isPaused: boolean;
  isSyncing: boolean;
};

// FetchHandler types
export type FetchState = "idle" | "fetching" | "error";

// Config
export type Config<T extends object, C, Q = unknown> = {
  id: string;
  initialContext: C;
  getId: (item: T) => string;
  setId?: (item: T, newId: string) => T; // Optional: update item's ID after server assigns permanent ID

  // Sync configuration
  syncDebounce?: number; // ms, default 300
  syncRetries?: number; // default 3
  refetchOnMutation?: boolean; // refetch after create/delete, default false
  enableEnqueue?: (context: C) => boolean; // whether to enqueue changes, default () => true

  // Cache configuration
  cacheCapacity?: number; // default 10
  cacheTtl?: number; // ms, default 60000

  // Fetch configuration
  fetchRetries?: number; // default 0

  // Tree configuration
  rootId?: string; // If set, collection is a tree
  getNodeId?: () => string; // Custom node ID generator (default: lodash uniqueId)
  nodeSeparator?: string; // Separator for node IDs (default: ".")

  // Query parsing - compute query from context for onSync
  parseQuery?: (context: C) => Q;

  // Unified handler for fetch and sync (optional - defaults to offline-first mode)
  onSync?: (params: OnSyncParams<T, C, Q>) => Promise<OnSyncResult<T>>;
};
