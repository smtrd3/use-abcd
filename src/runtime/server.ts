import type { Change, SyncResult } from "../types";
import {
  type SyncHandlerResult,
  type SyncBatchResult,
  type Schema,
  type SyncRequestBody,
  type SyncResponseBody,
  categorizeResults,
} from "./types";

// Re-export shared types for server module consumers
export type { SyncHandlerResult, SyncBatchResult, Schema, SyncRequestBody, SyncResponseBody };
export { categorizeResults };

// ============================================================================
// Types
// ============================================================================

export type ServerFetchHandler<T, Q> = (query: Q) => Promise<T[]> | T[];
export type ServerCreateHandler<T> = (data: T) => Promise<SyncHandlerResult> | SyncHandlerResult;
export type ServerUpdateHandler<T> = (
  id: string,
  data: T,
) => Promise<SyncHandlerResult> | SyncHandlerResult;
export type ServerDeleteHandler<T> = (
  id: string,
  data: T,
) => Promise<SyncHandlerResult> | SyncHandlerResult;

export type ServerSyncHandlerConfig<T, Q = unknown> = {
  schema?: Schema<T>;
  querySchema?: Schema<Q>;
  fetch?: ServerFetchHandler<T, Q>;
  create?: ServerCreateHandler<T>;
  update?: ServerUpdateHandler<T>;
  delete?: ServerDeleteHandler<T>;
};

export type ServerSyncHandler<T, Q = unknown> = {
  handler: (request: Request) => Promise<Response>;
  fetchItems: (query: Q) => Promise<T[]>;
  processChanges: (changes: Change<T>[]) => Promise<SyncResult[]>;
  processChangesWithStats: (changes: Change<T>[]) => Promise<SyncBatchResult>;
  handlers: {
    fetch?: ServerFetchHandler<T, Q>;
    create?: ServerCreateHandler<T>;
    update?: ServerUpdateHandler<T>;
    delete?: ServerDeleteHandler<T>;
  };
};

// ============================================================================
// Response Helpers
// ============================================================================

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const responses = {
  success: (data: unknown) => jsonResponse(data, 200),
  methodNotAllowed: () => jsonResponse({ error: "Method not allowed. Use POST." }, 405),
  invalidJson: () => jsonResponse({ error: "Invalid JSON body" }, 400),
  invalidPayload: () =>
    jsonResponse({ error: "Request body must contain 'query' and/or 'changes'" }, 400),
  validationError: (message: string) =>
    jsonResponse({ error: `Validation error: ${message}` }, 400),
  notConfigured: (handler: string) =>
    jsonResponse({ error: `${handler} handler not configured` }, 501),
  serverError: (error: unknown) =>
    jsonResponse({ error: error instanceof Error ? error.message : "Internal server error" }, 500),
} as const;

// ============================================================================
// Change Processing
// ============================================================================

type ChangeProcessor<T, Q> = {
  guard: (config: ServerSyncHandlerConfig<T, Q>) => boolean;
  execute: (
    change: Change<T>,
    config: ServerSyncHandlerConfig<T, Q>,
  ) => Promise<SyncHandlerResult> | SyncHandlerResult;
  toResult: (change: Change<T>, result: SyncHandlerResult) => SyncResult;
  notConfiguredError: string;
};

function createChangeProcessors<T, Q>(): Record<string, ChangeProcessor<T, Q>> {
  return {
    create: {
      guard: (config) => !!config.create,
      execute: (change, config) => config.create!(change.data),
      toResult: (change, result) =>
        result.success === true
          ? { id: change.id, status: "success" as const, newId: result.newId }
          : { id: change.id, status: "error" as const, error: result.error },
      notConfiguredError: "Create handler not configured",
    },

    update: {
      guard: (config) => !!config.update,
      execute: (change, config) => config.update!(change.id, change.data),
      toResult: (change, result) =>
        result.success === true
          ? { id: change.id, status: "success" as const }
          : { id: change.id, status: "error" as const, error: result.error },
      notConfiguredError: "Update handler not configured",
    },

    delete: {
      guard: (config) => !!config.delete,
      execute: (change, config) => config.delete!(change.id, change.data),
      toResult: (change, result) =>
        result.success === true
          ? { id: change.id, status: "success" as const }
          : { id: change.id, status: "error" as const, error: result.error },
      notConfiguredError: "Delete handler not configured",
    },
  };
}

function validateData<T>(
  data: unknown,
  schema?: Schema<T>,
): { valid: true; data: T } | { valid: false; error: string } {
  if (!schema) return { valid: true, data: data as T };

  const result = schema.safeParse(data);
  return result.success === true
    ? { valid: true, data: result.data }
    : { valid: false, error: result.error.message };
}

async function processServerChange<T, Q>(
  change: Change<T>,
  config: ServerSyncHandlerConfig<T, Q>,
): Promise<SyncResult> {
  const processors = createChangeProcessors<T, Q>();
  const processor = processors[change.type];

  if (!processor) {
    return { id: change.id, status: "error", error: `Unknown change type: ${change.type}` };
  }

  if (!processor.guard(config)) {
    return { id: change.id, status: "error", error: processor.notConfiguredError };
  }

  const validation = validateData(change.data, config.schema);
  if (validation.valid === false) {
    return { id: change.id, status: "error", error: `Validation failed: ${validation.error}` };
  }

  try {
    const result = await processor.execute({ ...change, data: validation.data }, config);
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

export function serverSyncSuccess(options?: { newId?: string }): SyncHandlerResult {
  return { success: true, ...options };
}

export function serverSyncError(error: string): SyncHandlerResult {
  return { success: false, error };
}

export function createSyncServer<T, Q = unknown>(
  config: ServerSyncHandlerConfig<T, Q>,
): ServerSyncHandler<T, Q> {
  const fetchItems = async (query: Q): Promise<T[]> => {
    if (!config.fetch) throw new Error("Fetch handler not configured");
    return config.fetch(query);
  };

  const processChanges = async (changes: Change<T>[]): Promise<SyncResult[]> => {
    return Promise.all(changes.map((change) => processServerChange(change, config)));
  };

  const processChangesWithStats = async (changes: Change<T>[]): Promise<SyncBatchResult> => {
    const results = await processChanges(changes);
    return categorizeResults(results);
  };

  const handlePost = async (request: Request): Promise<Response> => {
    let body: SyncRequestBody<T, Q>;
    try {
      body = await request.json();
    } catch {
      return responses.invalidJson();
    }

    if (!body.query && !body.changes) {
      return responses.invalidPayload();
    }

    const responseBody: SyncResponseBody<T> = {};

    if (body.query !== undefined) {
      if (!config.fetch) return responses.notConfigured("Fetch");

      const validation = validateData<Q>(body.query, config.querySchema);
      if (validation.valid === false) return responses.validationError(validation.error);

      responseBody.results = await fetchItems(validation.data);
    }

    if (body.changes !== undefined) {
      if (!Array.isArray(body.changes)) return responses.invalidPayload();
      responseBody.syncResults = await processChanges(body.changes);
    }

    return responses.success(responseBody);
  };

  const handler = async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST") return responses.methodNotAllowed();
      return await handlePost(request);
    } catch (error) {
      return responses.serverError(error);
    }
  };

  return {
    handler,
    fetchItems,
    processChanges,
    processChangesWithStats,
    handlers: {
      fetch: config.fetch,
      create: config.create,
      update: config.update,
      delete: config.delete,
    },
  };
}
