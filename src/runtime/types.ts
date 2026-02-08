import type { Change, SyncResult } from "../types";

export type SyncHandlerResult =
  | { success: true; newId?: string }
  | { success: false; error: string };

export type Schema<T> = {
  safeParse: (
    data: unknown,
  ) => { success: true; data: T } | { success: false; error: { message: string } };
};

export type SyncRequestBody<T extends object, Q = unknown> = {
  query?: Q;
  changes?: Change<T>[];
};

export type SyncResponseBody<T extends object, S = unknown> = {
  queryResults?: T[];
  syncResults?: SyncResult[];
  serverState?: S; // Optional server state (e.g., pagination: totalItems, nextCursor, etc.)
};

// Server-side timestamps auto-stamped by createSyncServer on create/update/delete handlers
export type ServerTimestamps = {
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
};
