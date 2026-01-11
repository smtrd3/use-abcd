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

export type Change<T> = {
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

// ID mapping from temporary to permanent ID (for create operations)
export type IdMapping = {
  tempId: string;
  newId: string;
};

// Error info for failed sync operations
export type SyncError<T> = {
  error: string;
  retries: number;
  operations: Change<T>[]; // The operations that failed, for manual retry
};

// SyncQueue state (accessible via getState/subscribe)
export type SyncQueueState<T> = {
  queue: Map<string, Change<T>[]>; // pending changes per item (coalesced operations)
  inFlight: Map<string, Change<T>[]>; // currently syncing operations per item
  errors: Map<string, SyncError<T>>; // failed items with retry info and operations
  isPaused: boolean;
  isSyncing: boolean;
};

// FetchHandler types
export type FetchState = "idle" | "fetching" | "error";

// Config
export type Config<T extends object, C> = {
  id: string;
  initialContext: C;
  getId: (item: T) => string;
  setId?: (item: T, newId: string) => T; // Optional: update item's ID after server assigns permanent ID

  // Sync configuration
  syncDebounce?: number; // ms, default 300
  syncRetries?: number; // default 3
  refetchOnMutation?: boolean; // refetch after create/delete, default false

  // Cache configuration
  cacheCapacity?: number; // default 10
  cacheTtl?: number; // ms, default 60000

  // Fetch configuration
  fetchRetries?: number; // default 0

  // Tree configuration
  rootId?: string; // If set, collection is a tree
  getNodeId?: () => string; // Custom node ID generator (default: lodash uniqueId)
  nodeSeparator?: string; // Separator for node IDs (default: ".")

  // Handlers
  onFetch: (context: C, signal: AbortSignal) => Promise<T[]>;
  onSync?: (changes: Change<T>[], signal: AbortSignal) => Promise<SyncResult[]>;
};
