import type { Change, SyncResult, OnSyncParams, OnSyncResult } from "../types";
import type { SyncHandlerResult, SyncRequestBody, SyncResponseBody } from "./types";

export type { SyncHandlerResult };

export type SyncClientConfig<T, Q = unknown> = {
  endpoint?: string;
  headers?: Record<string, string>;
  fetch?: (query: Q, signal: AbortSignal) => Promise<T[]>;
  create?: (data: T, signal: AbortSignal) => Promise<SyncHandlerResult>;
  update?: (id: string, data: T, signal: AbortSignal) => Promise<SyncHandlerResult>;
  delete?: (id: string, data: T, signal: AbortSignal) => Promise<SyncHandlerResult>;
};

export const syncSuccess = (opts?: { newId?: string }): SyncHandlerResult => ({
  success: true,
  ...opts,
});
export const syncError = (error: string): SyncHandlerResult => ({ success: false, error });

async function processChange<T>(
  change: Change<T>,
  config: SyncClientConfig<T>,
  signal: AbortSignal,
): Promise<SyncResult> {
  if (signal.aborted) return { id: change.id, status: "error", error: "Aborted" };

  try {
    let result: SyncHandlerResult;
    if (change.type === "create" && config.create) {
      result = await config.create(change.data, signal);
    } else if (change.type === "update" && config.update) {
      result = await config.update(change.id, change.data, signal);
    } else if (change.type === "delete" && config.delete) {
      result = await config.delete(change.id, change.data, signal);
    } else {
      return { id: change.id, status: "success" }; // offline-first: no handler = success
    }

    if (result.success === true) {
      return { id: change.id, status: "success", newId: result.newId };
    }
    return {
      id: change.id,
      status: "error",
      error: (result as { success: false; error: string }).error,
    };
  } catch (e) {
    return {
      id: change.id,
      status: "error",
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

async function endpointSync<T, C, Q>(
  endpoint: string,
  headers: Record<string, string>,
  params: OnSyncParams<T, C, Q>,
): Promise<OnSyncResult<T>> {
  const { changes, query, signal } = params;
  const hasQuery = query !== undefined;
  const hasChanges = changes && changes.length > 0;

  // Build request body with both query and changes if present
  const body: SyncRequestBody<T, Q> = {};
  if (hasQuery) body.query = query;
  if (hasChanges) body.changes = changes;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errMsg = await res
        .json()
        .then((b) => b.error)
        .catch(() => "Request failed");
      // If only fetching (no changes), throw error
      if (!hasChanges) throw new Error(errMsg);
      return {
        queryResults: [],
        syncResults: changes.map((c) => ({ id: c.id, status: "error", error: errMsg })),
      };
    }

    const data: SyncResponseBody<T> = await res.json();
    return {
      queryResults: data.results ?? [],
      syncResults:
        data.syncResults ??
        (hasChanges
          ? changes.map((c) => ({ id: c.id, status: "error", error: "No results" }))
          : []),
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Unknown error";
    // If only fetching (no changes), throw error
    if (!hasChanges) throw new Error(err);
    return {
      queryResults: [],
      syncResults: changes.map((c) => ({ id: c.id, status: "error", error: err })),
    };
  }
}

export function createSyncClient<T, C = unknown, Q = unknown>(
  config: SyncClientConfig<T, Q>,
): {
  onSync: (params: OnSyncParams<T, C, Q>) => Promise<OnSyncResult<T>>;
} {
  const onSync = async (params: OnSyncParams<T, C, Q>): Promise<OnSyncResult<T>> => {
    const { changes, query, signal } = params;
    const hasQuery = query !== undefined;
    const hasChanges = changes && changes.length > 0;

    // Warn and return empty results if neither query nor changes provided
    if (!hasQuery && !hasChanges) {
      console.warn("[createSyncClient] onSync called without query or changes");
      return { queryResults: [], syncResults: [] };
    }

    // Endpoint mode - handles both query and changes together
    if (config.endpoint) {
      return endpointSync<T, C, Q>(config.endpoint, config.headers ?? {}, params);
    }

    // Handler mode - process query and changes independently
    const queryResults = hasQuery && config.fetch ? await config.fetch(query as Q, signal) : [];
    const syncResults = hasChanges
      ? await Promise.all(changes.map((c) => processChange(c, config, signal)))
      : [];

    return { queryResults, syncResults };
  };

  return { onSync };
}
