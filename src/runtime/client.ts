import type { Change, SyncResult } from "../types";
import {
  type SyncHandlerResult,
  type SyncBatchResult,
  type SyncRequestBody,
  type SyncResponseBody,
  categorizeResults,
} from "./types";

export type { SyncHandlerResult, SyncBatchResult };
export { categorizeResults };

// ============================================================================
// Types
// ============================================================================

export type CreateHandler<T> = (data: T, signal: AbortSignal) => Promise<SyncHandlerResult>;
export type UpdateHandler<T> = (
  id: string,
  data: T,
  signal: AbortSignal,
) => Promise<SyncHandlerResult>;
export type DeleteHandler<T> = (
  id: string,
  data: T,
  signal: AbortSignal,
) => Promise<SyncHandlerResult>;

export type SyncBuilderConfig<T> = {
  create?: CreateHandler<T>;
  update?: UpdateHandler<T>;
  delete?: DeleteHandler<T>;
};

export type SyncBuilder<T> = {
  onSync: (changes: Change<T>[], signal: AbortSignal) => Promise<SyncResult[]>;
  handlers: {
    create?: CreateHandler<T>;
    update?: UpdateHandler<T>;
    delete?: DeleteHandler<T>;
  };
};

export type FetchToSyncResultOptions = {
  fetch: Promise<Response>;
  parseResponse?: (response: Response) => Promise<{ newId?: string }>;
  parseError?: string | ((error: unknown) => string);
};

// ============================================================================
// Change Processing
// ============================================================================

type ChangeProcessor<T> = {
  guard: (config: SyncBuilderConfig<T>) => boolean;
  execute: (
    change: Change<T>,
    config: SyncBuilderConfig<T>,
    signal: AbortSignal,
  ) => Promise<SyncHandlerResult>;
  toResult: (change: Change<T>, result: SyncHandlerResult) => SyncResult;
};

function createChangeProcessors<T>(): Record<string, ChangeProcessor<T>> {
  return {
    create: {
      guard: (config) => !!config.create,
      execute: (change, config, signal) => config.create!(change.data, signal),
      toResult: (change, result) =>
        result.success === true
          ? { id: change.id, status: "success" as const, newId: result.newId }
          : { id: change.id, status: "error" as const, error: result.error },
    },

    update: {
      guard: (config) => !!config.update,
      execute: (change, config, signal) => config.update!(change.id, change.data, signal),
      toResult: (change, result) =>
        result.success === true
          ? { id: change.id, status: "success" as const }
          : { id: change.id, status: "error" as const, error: result.error },
    },

    delete: {
      guard: (config) => !!config.delete,
      execute: (change, config, signal) => config.delete!(change.id, change.data, signal),
      toResult: (change, result) =>
        result.success === true
          ? { id: change.id, status: "success" as const }
          : { id: change.id, status: "error" as const, error: result.error },
    },
  };
}

async function processChange<T>(
  change: Change<T>,
  config: SyncBuilderConfig<T>,
  signal: AbortSignal,
): Promise<SyncResult> {
  if (signal.aborted) {
    return { id: change.id, status: "error", error: "Operation aborted" };
  }

  const processors = createChangeProcessors<T>();
  const processor = processors[change.type];

  if (!processor) {
    return { id: change.id, status: "error", error: `Unknown change type: ${change.type}` };
  }

  // If handler not configured, treat as success (offline-first support)
  if (!processor.guard(config)) {
    return { id: change.id, status: "success" };
  }

  try {
    const result = await processor.execute(change, config, signal);
    return processor.toResult(change, result);
  } catch (error) {
    return {
      id: change.id,
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Public API
// ============================================================================

export function createSyncClient<T>(config: SyncBuilderConfig<T>): SyncBuilder<T> {
  const onSync = async (changes: Change<T>[], signal: AbortSignal): Promise<SyncResult[]> => {
    return Promise.all(changes.map((change) => processChange(change, config, signal)));
  };

  return {
    onSync,
    handlers: { create: config.create, update: config.update, delete: config.delete },
  };
}

export function createSyncClientWithStats<T>(config: SyncBuilderConfig<T>): {
  onSync: (changes: Change<T>[], signal: AbortSignal) => Promise<SyncResult[]>;
  onSyncWithStats: (changes: Change<T>[], signal: AbortSignal) => Promise<SyncBatchResult>;
  handlers: { create?: CreateHandler<T>; update?: UpdateHandler<T>; delete?: DeleteHandler<T> };
} {
  const { onSync, handlers } = createSyncClient(config);

  const onSyncWithStats = async (
    changes: Change<T>[],
    signal: AbortSignal,
  ): Promise<SyncBatchResult> => {
    const results = await onSync(changes, signal);
    return categorizeResults(results);
  };

  return { onSync, onSyncWithStats, handlers };
}

export function syncSuccess(options?: { newId?: string }): SyncHandlerResult {
  return { success: true, ...options };
}

export function syncError(error: string): SyncHandlerResult {
  return { success: false, error };
}

export type EndpointSyncClientConfig = {
  endpoint: string;
  headers?: Record<string, string>;
  scope?: string;
};

export type EndpointSyncClient<T, Q = unknown> = {
  onFetch: (query: Q, signal: AbortSignal) => Promise<T[]>;
  onSync: (changes: Change<T>[], signal: AbortSignal) => Promise<SyncResult[]>;
};

export function createSyncClientFromEndpoint<T, Q = unknown>(
  config: string | EndpointSyncClientConfig,
): EndpointSyncClient<T, Q> {
  const endpoint = typeof config === "string" ? config : config.endpoint;
  const headers = typeof config === "string" ? {} : (config.headers ?? {});
  const scope = typeof config === "string" ? undefined : config.scope;

  const onFetch = async (query: Q, signal: AbortSignal): Promise<T[]> => {
    if (signal.aborted) {
      throw new Error("Operation aborted");
    }

    try {
      const body: SyncRequestBody<T, Q> = { scope, query };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        let errorMsg = "Fetch request failed";
        try {
          const errorBody = await response.json();
          if (errorBody.error) errorMsg = errorBody.error;
        } catch {
          // Ignore JSON parse errors
        }
        throw new Error(errorMsg);
      }

      const responseBody: SyncResponseBody<T> = await response.json();
      return responseBody.results ?? [];
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Operation aborted");
      }
      throw error;
    }
  };

  const onSync = async (changes: Change<T>[], signal: AbortSignal): Promise<SyncResult[]> => {
    if (signal.aborted) {
      return changes.map((c) => ({
        id: c.id,
        status: "error" as const,
        error: "Operation aborted",
      }));
    }

    try {
      const body: SyncRequestBody<T, Q> = { scope, changes };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        let errorMsg = "Sync request failed";
        try {
          const errorBody = await response.json();
          if (errorBody.error) errorMsg = errorBody.error;
        } catch {
          // Ignore JSON parse errors
        }
        return changes.map((c) => ({ id: c.id, status: "error" as const, error: errorMsg }));
      }

      const responseBody: SyncResponseBody<T> = await response.json();
      return (
        responseBody.syncResults ??
        changes.map((c) => ({
          id: c.id,
          status: "error" as const,
          error: "No sync results returned",
        }))
      );
    } catch (error) {
      const errorMsg =
        error instanceof Error && error.name === "AbortError"
          ? "Operation aborted"
          : error instanceof Error
            ? error.message
            : "Unknown error";
      return changes.map((c) => ({ id: c.id, status: "error" as const, error: errorMsg }));
    }
  };

  return { onFetch, onSync };
}

export async function fetchToSyncResult(
  options: FetchToSyncResultOptions,
): Promise<SyncHandlerResult> {
  const { fetch: fetchPromise, parseResponse, parseError } = options;

  const getErrorMessage = (error: unknown): string => {
    if (typeof parseError === "function") return parseError(error);
    if (typeof parseError === "string") return parseError;
    return error instanceof Error ? error.message : "Request failed";
  };

  try {
    const response = await fetchPromise;

    if (!response.ok) {
      let error: unknown = new Error("Request failed");
      try {
        const body = await response.json();
        if (body.message) error = new Error(body.message);
        else if (body.error) error = new Error(body.error);
      } catch {
        // Ignore JSON parse errors
      }
      return { success: false, error: getErrorMessage(error) };
    }

    if (parseResponse) {
      const result = await parseResponse(response);
      return { success: true, ...result };
    }

    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { success: false, error: "Operation aborted" };
    }
    return { success: false, error: getErrorMessage(error) };
  }
}
