// Shared types (used by both client and server)
export {
  type SyncHandlerResult,
  type SyncBatchResult,
  type Schema,
  type SyncRequestBody,
  type SyncResponseBody,
  categorizeResults,
} from "./types";

// Client-side sync utilities
export {
  createSyncClient,
  createSyncClientWithStats,
  createSyncClientFromEndpoint,
  syncSuccess,
  syncError,
  fetchToSyncResult,
} from "./client";
export type {
  CreateHandler,
  UpdateHandler,
  DeleteHandler,
  SyncBuilderConfig,
  SyncBuilder,
  FetchToSyncResultOptions,
  EndpointSyncClientConfig,
  EndpointSyncClient,
} from "./client";

// Server-side sync utilities
export { createSyncServer, serverSyncSuccess, serverSyncError } from "./server";
export type {
  ServerFetchHandler,
  ServerCreateHandler,
  ServerUpdateHandler,
  ServerDeleteHandler,
  ServerSyncHandlerConfig,
  ServerSyncHandler,
} from "./server";
