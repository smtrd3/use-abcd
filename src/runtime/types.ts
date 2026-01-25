import type { Change, SyncResult } from "../types";

export type SyncHandlerResult =
  | { success: true; newId?: string }
  | { success: false; error: string };

export type Schema<T> = {
  safeParse: (
    data: unknown,
  ) => { success: true; data: T } | { success: false; error: { message: string } };
};

export type SyncRequestBody<T, Q = unknown> = {
  query?: Q;
  changes?: Change<T>[];
};

export type SyncResponseBody<T> = {
  results?: T[];
  syncResults?: SyncResult[];
};
