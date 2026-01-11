// Hooks
export { useCrud } from "./useCrud";
export { useCrudTree } from "./useCrudTree";
export type { TreeConfig } from "./useCrudTree";
export { useItem } from "./useItem";
export type { UseItemResult } from "./useItem";
export { useNode } from "./useNode";
export type { UseNodeResult } from "./useNode";
export { useSelectedNode } from "./useSelectedNode";
export { useSyncState } from "./useSyncState";
export type { UseSyncStateResult } from "./useSyncState";

// Classes
export { Collection } from "./collection";
export type { CollectionState } from "./collection";
export { Item } from "./item";
export { Node } from "./node";
export type { TreeNode } from "./node";
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
