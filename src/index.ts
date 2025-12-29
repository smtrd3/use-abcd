// Hooks
export { useCrud } from "./useCrud";
export { useItem } from "./useItem";
export type { UseItemResult } from "./useItem";

// Classes
export { Collection } from "./collection";
export type { CollectionState } from "./collection";
export { Item } from "./item";
export { Cache } from "./cache";
export { SyncQueue } from "./sync-queue";
export type { SyncQueueConfig } from "./sync-queue";
export { FetchHandler } from "./fetch-handler";
export type { FetchHandlerConfig, FetchHandlerState } from "./fetch-handler";

// Types
export type {
  Config,
  Change,
  SyncResult,
  IdMapping,
  SyncError,
  ItemStatus,
  SyncQueueState,
  SyncState,
  ChangeType,
  ItemSyncStatus,
  FetchState,
  JsonValue,
  PlainObject,
  Result,
  Fn,
  Mutator,
} from "./types";

// Sync utilities (Client-side only - server utilities are in use-abcd/runtime/server)
export {
  // Shared
  categorizeResults,
  // Client
  createSyncClient,
  createSyncClientWithStats,
  createSyncClientFromEndpoint,
  syncSuccess,
  syncError,
  fetchToSyncResult,
} from "./runtime";
export type {
  // Shared
  SyncHandlerResult,
  SyncBatchResult,
  Schema,
  SyncRequestBody,
  SyncResponseBody,
  // Client
  CreateHandler,
  UpdateHandler,
  DeleteHandler,
  SyncBuilderConfig,
  SyncBuilder,
  FetchToSyncResultOptions,
  EndpointSyncClientConfig,
  EndpointSyncClient,
} from "./runtime";
