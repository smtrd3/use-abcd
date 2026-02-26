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

// Error info for failed sync operations
export type SyncError<T> = {
  error: string;
  retries: number;
  operation: Change<T>;
};

// SyncQueue state (accessible via getState/subscribe)
export type SyncQueueState<T> = {
  queue: Map<string, Change<T>>;
  inFlight: Map<string, Change<T>>;
  errors: Map<string, SyncError<T>>;
  isPaused: boolean;
  isSyncing: boolean;
};

// FetchHandler types
export type FetchState = "idle" | "fetching" | "error";

// Unified handler type
export type CrudHandler<T extends { id: string }, C> = (
  params: { query?: C; changes?: Change<T>[] },
  signal: AbortSignal,
) => Promise<{ results?: T[]; syncResults?: Record<string, Result>; serverTimeStamp?: string }>;

// Config
export type Config<T extends { id: string }, C> = {
  id: string;
  initialContext: C;
  serverItems?: T[];

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

  // Unified handler (replaces onFetch + onSync)
  handler?: CrudHandler<T, C>;
};
