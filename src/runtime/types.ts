import type { Change, Result } from "../types";

// Server-side record format for change tracking
export type ServerRecord<T> = {
  id: string;
  data: T;
  serverTimeStamp: string;
  deleted: boolean;
};

// Request body for the unified POST endpoint
export type SyncRequestBody<T, Q = unknown> = {
  scope?: string;
  query?: Q;
  changes?: Change<T>[];
};

// Response body from the unified POST endpoint
export type SyncResponseBody<T, S = unknown> = {
  results?: T[];
  syncResults?: Record<string, Result>;
  serverState?: S;
  serverTimeStamp?: string;
};
