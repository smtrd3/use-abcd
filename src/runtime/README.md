# Runtime Sync Utilities

Client and server utilities for building type-safe CRUD sync operations.

## Overview

The runtime module provides:

- **Client-side**: `createSyncClient` for creating sync handlers with parallel execution
- **Server-side**: `createSyncServer` for creating unified CRUD endpoints
- **Shared types**: Common result types used by both client and server

## Import Paths

```typescript
// From main package (client utilities only)
import { createSyncClient, fetchToSyncResult } from "use-abcd";

// From runtime/client (both client and server utilities)
import { createSyncClient, createSyncServer } from "use-abcd/runtime/client";

// From runtime/server (server utilities only)
import { createSyncServer, serverSyncSuccess } from "use-abcd/runtime/server";
```

## Client-Side Guide

### Basic Usage

```typescript
import { createSyncClient, fetchToSyncResult } from "use-abcd";

const { onSync } = createSyncClient<User>({
  create: async (data, signal) => {
    const response = await fetch("/api/users", {
      method: "POST",
      body: JSON.stringify(data),
      signal,
    });
    if (!response.ok) {
      return { success: false, error: "Failed to create user" };
    }
    const result = await response.json();
    return { success: true, newId: result.id };
  },

  update: async (id, data, signal) => {
    const response = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
      signal,
    });
    if (!response.ok) {
      return { success: false, error: "Failed to update user" };
    }
    return { success: true };
  },

  delete: async (id, data, signal) => {
    const response = await fetch(`/api/users/${id}`, {
      method: "DELETE",
      signal,
    });
    if (!response.ok) {
      return { success: false, error: "Failed to delete user" };
    }
    return { success: true };
  },
});

// Use in config
const config: Config<User, UserContext> = {
  // ...
  onSync,
};
```

### Using fetchToSyncResult Helper

Simplifies fetch-based handlers:

```typescript
const { onSync } = createSyncClient<User>({
  create: async (data, signal) => {
    return fetchToSyncResult({
      fetch: fetch("/api/users", {
        method: "POST",
        body: JSON.stringify(data),
        signal,
      }),
      parseResponse: async (response) => {
        const result = await response.json();
        return { newId: result.id };
      },
      parseError: "Failed to create user",
    });
  },

  update: async (id, data, signal) => {
    return fetchToSyncResult({
      fetch: fetch(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
        signal,
      }),
      parseError: (error) =>
        `Update failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  },
});
```

### Getting Batch Statistics

Use `createSyncClientWithStats` for detailed results:

```typescript
import { createSyncClientWithStats } from "use-abcd";

const { onSync, onSyncWithStats } = createSyncClientWithStats<User>({
  // ... handlers
});

const batchResult = await onSyncWithStats(changes, signal);
if (!batchResult.allSucceeded) {
  console.error(`${batchResult.summary.failed} operations failed`);
}
```

### Helper Functions

```typescript
import { syncSuccess, syncError } from "use-abcd";

// Return success
return syncSuccess({ newId: "abc123" });

// Return error
return syncError("Something went wrong");
```

## Server-Side Guide

### Basic Usage

```typescript
import { createSyncServer, serverSyncSuccess, serverSyncError } from "use-abcd/runtime/server";

const usersHandler = createSyncServer<User, UserQuery>({
  fetch: async (query) => {
    return db.users.findMany({
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  },

  create: async (data) => {
    const user = await db.users.create({ data });
    return serverSyncSuccess({ newId: user.id });
  },

  update: async (id, data) => {
    await db.users.update({ where: { id }, data });
    return serverSyncSuccess();
  },

  delete: async (id) => {
    await db.users.delete({ where: { id } });
    return serverSyncSuccess();
  },
});
```

### With Zod Validation

```typescript
import { z } from "zod";
import { createSyncServer } from "use-abcd/runtime/server";

const UserSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
});

const UserQuerySchema = z.object({
  page: z.number().default(1),
  limit: z.number().default(10),
  search: z.string().optional(),
});

const usersHandler = createSyncServer<User, UserQuery>({
  schema: UserSchema,
  querySchema: UserQuerySchema,
  // ... handlers
});
```

### Request/Response Format

The server handler accepts POST requests with:

```typescript
// Fetch items
POST /api/users
Body: { query: { page: 1, limit: 10 } }
Response: { results: [...users] }

// Sync changes
POST /api/users
Body: { changes: [{ id: "1", type: "update", data: {...} }] }
Response: { syncResults: [{ id: "1", status: "success" }] }

// Both in one request
POST /api/users
Body: { query: { page: 1 }, changes: [...] }
Response: { results: [...], syncResults: [...] }
```

### Framework Integration

```typescript
// Hono
app.post("/api/users", (c) => usersHandler.handler(c.req.raw));

// Next.js App Router
export const POST = usersHandler.handler;

// Bun.serve
Bun.serve({
  fetch(req) {
    if (new URL(req.url).pathname === "/api/users") {
      return usersHandler.handler(req);
    }
  },
});
```

### Direct Method Access

For custom integrations:

```typescript
// Fetch items directly
const items = await usersHandler.fetchItems({ page: 1, limit: 10 });

// Process changes directly
const results = await usersHandler.processChanges(changes);

// With statistics
const batchResult = await usersHandler.processChangesWithStats(changes);
```

## Types Reference

### Shared Types

| Type                    | Description                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `SyncHandlerResult`     | `{ success: true; newId?: string }` or `{ success: false; error: string }`                           |
| `SyncBatchResult`       | Aggregated results with `results`, `successful`, `failed`, `allSucceeded`, `anySucceeded`, `summary` |
| `Schema<T>`             | Zod-compatible schema interface                                                                      |
| `SyncRequestBody<T, Q>` | `{ query?: Q; changes?: Change<T>[] }`                                                               |
| `SyncResponseBody<T>`   | `{ results?: T[]; syncResults?: SyncResult[] }`                                                      |

### Client Types

| Type                   | Description                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| `CreateHandler<T>`     | `(data: T, signal: AbortSignal) => Promise<SyncHandlerResult>`             |
| `UpdateHandler<T>`     | `(id: string, data: T, signal: AbortSignal) => Promise<SyncHandlerResult>` |
| `DeleteHandler<T>`     | `(id: string, data: T, signal: AbortSignal) => Promise<SyncHandlerResult>` |
| `SyncBuilderConfig<T>` | Config with optional `create`, `update`, `delete` handlers                 |
| `SyncBuilder<T>`       | Result with `onSync` function and `handlers`                               |

### Server Types

| Type                            | Description                                                                |
| ------------------------------- | -------------------------------------------------------------------------- |
| `ServerFetchHandler<T, Q>`      | `(query: Q) => Promise<T[]> \| T[]`                                        |
| `ServerCreateHandler<T>`        | `(data: T) => Promise<SyncHandlerResult> \| SyncHandlerResult`             |
| `ServerUpdateHandler<T>`        | `(id: string, data: T) => Promise<SyncHandlerResult> \| SyncHandlerResult` |
| `ServerDeleteHandler<T>`        | `(id: string, data: T) => Promise<SyncHandlerResult> \| SyncHandlerResult` |
| `ServerSyncHandlerConfig<T, Q>` | Config with `schema`, `querySchema`, and handlers                          |
| `ServerSyncHandler<T, Q>`       | Result with `handler`, `fetchItems`, `processChanges`, etc.                |
