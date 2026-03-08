import { isArray, map, get } from "lodash-es";
import type { Change, Result } from "../types";
import type { SyncRequestBody, SyncResponseBody, ServerRecord } from "./types";
import { getIdFromTime } from "../utils";

export type { SyncRequestBody, SyncResponseBody, ServerRecord };

export type CrudHandler<T, Q = unknown> = (request: {
  scope?: string;
  query?: Q;
  changes?: Change<T>[];
}) => Promise<SyncResponseBody<T>> | SyncResponseBody<T>;

export type FetchResult<T, S = unknown> = T[] | { items: T[]; serverState?: S };

export type SyncServerConfig<T extends { id: string }, Q = unknown, S = unknown> = {
  fetch: (params: { scope?: string; query: Q }) => Promise<FetchResult<T, S>> | FetchResult<T, S>;
  create: (record: ServerRecord<T>, request: SyncRequestBody<T, Q>) => Promise<void> | void;
  update: (record: ServerRecord<T>, request: SyncRequestBody<T, Q>) => Promise<void> | void;
  remove: (record: ServerRecord<T>, request: SyncRequestBody<T, Q>) => Promise<void> | void;
};

const operations: Record<string, "create" | "update" | "remove"> = {
  create: "create",
  update: "update",
  delete: "remove",
};

export function createCrudHandler<T extends { id: string }, Q = unknown, S = unknown>(
  config: SyncServerConfig<T, Q, S>,
): CrudHandler<T, Q> {
  return async (request) => {
    const serverSyncedAt = getIdFromTime();
    const response: SyncResponseBody<T> = { serverSyncedAt };

    // Process all changes in parallel
    if (request.changes) {
      response.syncResults = await Promise.all(
        map(request.changes, async (change): Promise<Result> => {
          try {
            const record: ServerRecord<T> = {
              id: change.data.id,
              data: change.data,
              serverSyncedAt,
              deleted: change.type === "delete",
            };

            await get(config, operations[change.type])(record, request);
            return { status: "success", id: change.data.id, type: change.type, serverSyncedAt };
          } catch (error) {
            return {
              status: "error",
              id: change.data.id,
              type: change.type,
              serverSyncedAt,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        }),
      );
    }

    if (request.query !== undefined) {
      const result = await config.fetch({ scope: request.scope, query: request.query });
      if (isArray(result)) {
        response.items = result;
      } else {
        response.items = result.items;
        response.serverState = result.serverState;
      }
    }

    return response;
  };
}

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export function createSyncServer<T, Q = unknown>(handler: CrudHandler<T, Q>) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
    }

    let body: SyncRequestBody<T, Q>;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (body.query === undefined && !body.changes) {
      return jsonResponse({ error: "Request body must contain 'query' and/or 'changes'" }, 400);
    }

    try {
      const result = await handler({
        scope: body.scope,
        query: body.query,
        changes: body.changes,
      });
      return jsonResponse(result, 200);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Internal server error" },
        500,
      );
    }
  };
}
