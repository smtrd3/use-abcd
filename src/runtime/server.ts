import { isArray, map } from "lodash-es";
import type { Change, SyncResult } from "../types";
import type { SyncHandlerResult, Schema, SyncRequestBody, SyncResponseBody, ServerTimestamps } from "./types";

export type { SyncHandlerResult, Schema };

type Ctx<T extends object, Q> = { body: SyncRequestBody<T, Q> };

export type FetchResult<T extends object, S = unknown> = {
  items: T[];
  serverState?: S;
};

export type SyncServerConfig<T extends object, Q = unknown, S = unknown> = {
  schema?: Schema<T>;
  querySchema?: Schema<Q>;
  fetch?: (query: Q, ctx: Ctx<T, Q>) => Promise<T[] | FetchResult<T, S>> | T[] | FetchResult<T, S>;
  create?: (data: T & ServerTimestamps, ctx: Ctx<T, Q>) => Promise<SyncHandlerResult> | SyncHandlerResult;
  update?: (id: string, data: T & ServerTimestamps, ctx: Ctx<T, Q>) => Promise<SyncHandlerResult> | SyncHandlerResult;
  delete?: (id: string, data: T & ServerTimestamps, ctx: Ctx<T, Q>) => Promise<SyncHandlerResult> | SyncHandlerResult;
};

export const serverSyncSuccess = (opts?: { newId?: string }): SyncHandlerResult => ({
  success: true,
  ...opts,
});

export const serverSyncError = (error: string): SyncHandlerResult => ({ success: false, error });

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validate = <T>(
  data: unknown,
  schema?: Schema<T>,
): { ok: true; data: T } | { ok: false; error: string } => {
  if (!schema) return { ok: true, data: data as T };
  const r = schema.safeParse(data);
  if (r.success === true) return { ok: true, data: r.data };
  return { ok: false, error: (r as { success: false; error: { message: string } }).error.message };
};

const toSyncResult = (id: string, result: SyncHandlerResult): SyncResult => {
  if (result.success === true) return { id, status: "success", newId: result.newId };
  return { id, status: "error", error: result.error };
};

async function processChange<T extends object, Q>(
  change: Change<T>,
  config: SyncServerConfig<T, Q>,
  ctx: Ctx<T, Q>,
): Promise<SyncResult> {
  const v = validate(change.data, config.schema);
  if (!v.ok)
    return { id: change.id, status: "error", error: (v as { ok: false; error: string }).error };

  const now = Date.now();

  try {
    if (change.type === "create" && config.create) {
      const stamped = { ...v.data, createdAt: now, updatedAt: now, deletedAt: null } as T & ServerTimestamps;
      return toSyncResult(change.id, await config.create(stamped, ctx));
    }
    if (change.type === "update" && config.update) {
      const stamped = { ...v.data, updatedAt: now } as T & ServerTimestamps;
      return toSyncResult(change.id, await config.update(change.id, stamped, ctx));
    }
    if (change.type === "delete" && config.delete) {
      const stamped = { ...v.data, deletedAt: now, updatedAt: now } as T & ServerTimestamps;
      return toSyncResult(change.id, await config.delete(change.id, stamped, ctx));
    }
    return { id: change.id, status: "error", error: `${change.type} handler not configured` };
  } catch (e) {
    return {
      id: change.id,
      status: "error",
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

// Helper to check if fetch result is FetchResult object or plain array
function isFetchResult<T extends object, S>(result: T[] | FetchResult<T, S>): result is FetchResult<T, S> {
  return !isArray(result) && typeof result === "object" && "items" in result;
}

export function createSyncServer<T extends object, Q = unknown, S = unknown>(
  config: SyncServerConfig<T, Q, S>,
): {
  handler: (request: Request) => Promise<Response>;
} {
  const handler = async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let body: SyncRequestBody<T, Q>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const hasQuery = body.query !== undefined && body.query !== null;
    const hasChanges = isArray(body.changes);
    if (!hasQuery && !hasChanges) return json({ error: "Missing query or changes" }, 400);

    const ctx: Ctx<T, Q> = { body };
    const res: SyncResponseBody<T, S> = {};

    if (hasQuery) {
      if (!config.fetch) return json({ error: "Fetch not configured" }, 501);
      const v = validate(body.query, config.querySchema);
      if (!v.ok) return json({ error: (v as { ok: false; error: string }).error }, 400);

      const fetchResult = await config.fetch((v as { ok: true; data: Q }).data, ctx);
      if (isFetchResult(fetchResult)) {
        res.queryResults = fetchResult.items;
        res.serverState = fetchResult.serverState;
      } else {
        res.queryResults = fetchResult;
      }
    }

    if (hasChanges && body.changes!.length > 0) {
      res.syncResults = await Promise.all(map(body.changes!, (c) => processChange(c, config, ctx)));
    }

    return json(res, 200);
  };

  return { handler };
}
