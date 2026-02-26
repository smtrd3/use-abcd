import type { Change } from "../types";
import type { SyncRequestBody, SyncResponseBody } from "./types";

export type { SyncRequestBody, SyncResponseBody };

export type SyncClientConfig = {
  endpoint: string;
  headers?: Record<string, string>;
  scope?: string;
};

export function createSyncClient<T extends { id: string }, Q = unknown>(
  config: string | SyncClientConfig,
) {
  const endpoint = typeof config === "string" ? config : config.endpoint;
  const headers = typeof config === "string" ? {} : (config.headers ?? {});
  const scope = typeof config === "string" ? undefined : config.scope;

  return async (
    params: { query?: Q; changes?: Change<T>[] },
    signal: AbortSignal,
  ): Promise<SyncResponseBody<T>> => {
    if (signal.aborted) throw new Error("Operation aborted");

    const body: SyncRequestBody<T, Q> = {
      scope,
      query: params.query,
      changes: params.changes,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      let errorMsg = "Request failed";
      try {
        const errorBody = await response.json();
        if (errorBody.error) errorMsg = errorBody.error;
      } catch {
        // Ignore JSON parse errors
      }
      throw new Error(errorMsg);
    }

    return response.json();
  };
}
