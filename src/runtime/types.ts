import type { Change, ChangeType, SyncResponse } from "../types";

// Server-side record format for change tracking
export type ServerRecord<T> = {
  id: string;
  data: T;
  serverSyncedAt: string;
  deleted: boolean;
};

// Local IDB record format
export type LocalRecord<T> = {
  id: string;
  data: T;
  serverSyncedAt: string;
  deleted: boolean;
  lastOperation: ChangeType;
};

// Metadata store record
export type MetadataRecord = {
  id: string;
  value: string;
};

// Config for createLocalSyncClient
export type LocalSyncClientConfig = {
  dbName: string;
  version?: number;
  remoteSyncEndpoint?: string;
  headers?: Record<string, string>;
  scope?: string;
  collectionId?: string;
  debounce?: number;
  maxRetries?: number;
  batchSize?: number;
};

// Request body for the unified POST endpoint
export type SyncRequestBody<T, Q = unknown> = {
  scope?: string;
  query?: Q;
  changes?: Change<T>[];
};

// Response body from the unified POST endpoint
export type SyncResponseBody<T, S = unknown> = SyncResponse<T> & {
  serverState?: S;
};
