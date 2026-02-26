import { ulid } from "ulid";
import { fromPairs, isArray, map } from "lodash-es";
import type { Change, Result } from "../types";
import type { SyncRequestBody, SyncResponseBody, ServerRecord } from "./types";

export type { SyncRequestBody, SyncResponseBody, ServerRecord };

export type CrudHandler<T, Q = unknown> = (request: {
  scope?: string;
  query?: Q;
  changes?: Change<T>[];
}) => Promise<SyncResponseBody<T>> | SyncResponseBody<T>;

export type FetchResult<T, S = unknown> = T[] | { items: T[]; serverState?: S };

export type SyncServerConfig<
  T extends { id: string },
  Q = unknown,
  S = unknown,
> = {
  fetch?: (params: { scope?: string; query: Q }) => Promise<FetchResult<T, S>> | FetchResult<T, S>;
  create?: (record: ServerRecord<T>) => Promise<void> | void;
  update?: (record: ServerRecord<T>) => Promise<void> | void;
  remove?: (record: ServerRecord<T>) => Promise<void> | void;
};

export function createCrudHandler<
  T extends { id: string },
  Q = unknown,
  S = unknown,
>(config: SyncServerConfig<T, Q, S>): CrudHandler<T, Q> {
  return async (request) => {
    const response: SyncResponseBody<T> = {};
    const serverTimeStamp = ulid();

    response.serverTimeStamp = serverTimeStamp;

    // Process all changes in parallel
    if (request.changes) {
      const entries = await Promise.all(
        map(request.changes, async (change): Promise<[string, Result]> => {
          try {
            const record: ServerRecord<T> = {
              id: change.data.id,
              data: change.data,
              serverTimeStamp,
              deleted: change.type === "delete",
            };

            if (change.type === "create" && config.create) {
              await config.create(record);
            } else if (change.type === "update" && config.update) {
              await config.update(record);
            } else if (change.type === "delete" && config.remove) {
              await config.remove(record);
            }
            return [change.id, { status: "success" }];
          } catch (error) {
            return [change.id, {
              status: "error",
              error: error instanceof Error ? error.message : "Unknown error",
            }];
          }
        }),
      );

      response.syncResults = fromPairs(entries);
    }

    if (request.query !== undefined && config.fetch) {
      const result = await config.fetch({ scope: request.scope, query: request.query });
      if (isArray(result)) {
        response.results = result;
      } else {
        response.results = result.items;
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
