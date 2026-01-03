import type { Change, SyncResult } from "../types";

// ============================================================================
// Shared Types (used by both client and server)
// ============================================================================

/**
 * Result of a sync operation handler.
 * Used by both client-side and server-side handlers.
 */
export type SyncHandlerResult =
  | { success: true; newId?: string }
  | { success: false; error: string };

/**
 * Zod-like schema interface (duck typing to avoid hard dependency)
 */
export type Schema<T> = {
  safeParse: (
    data: unknown,
  ) => { success: true; data: T } | { success: false; error: { message: string } };
};

/**
 * Aggregated results from sync operations.
 * Provides categorized results and summary statistics.
 */
export type SyncBatchResult = {
  /** All results from the sync operation */
  results: SyncResult[];
  /** Results that succeeded */
  successful: SyncResult[];
  /** Results that failed */
  failed: SyncResult[];
  /** Whether all operations succeeded */
  allSucceeded: boolean;
  /** Whether any operations succeeded */
  anySucceeded: boolean;
  /** Summary counts */
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
};

/**
 * Categorize sync results into successful and failed
 */
export function categorizeResults(results: SyncResult[]): SyncBatchResult {
  const successful = results.filter((r) => r.status === "success");
  const failed = results.filter((r) => r.status === "error");

  return {
    results,
    successful,
    failed,
    allSucceeded: failed.length === 0,
    anySucceeded: successful.length > 0,
    summary: {
      total: results.length,
      succeeded: successful.length,
      failed: failed.length,
    },
  };
}

// ============================================================================
// Request/Response Types (for client-server communication)
// ============================================================================

/**
 * Request body for the unified POST endpoint
 */
export type SyncRequestBody<T, Q = unknown> = {
  /** Optional scope identifier for selecting storage on the backend */
  scope?: string;
  /** Query parameters for fetching items */
  query?: Q;
  /** Changes to sync */
  changes?: Change<T>[];
};

/**
 * Response body from the unified POST endpoint
 */
export type SyncResponseBody<T> = {
  /** Fetched items (when query was provided) */
  results?: T[];
  /** Sync results (when changes were provided) */
  syncResults?: SyncResult[];
};
