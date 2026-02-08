# Runtime Sync Utilities

Client and server utilities for type-safe CRUD sync operations.

## Imports

```typescript
// Client utilities
import { createSyncClient, syncSuccess, syncError } from "use-abcd/runtime/client";

// Server utilities
import { createSyncServer, serverSyncSuccess, serverSyncError } from "use-abcd/runtime/server";
```

## Client

### Endpoint Mode (Recommended)

```typescript
const { onSync } = createSyncClient<User, UserContext, UserQuery>({
  endpoint: "/api/users/sync",
  headers: { Authorization: "Bearer ..." }, // optional
});

// Use in config
const config: Config<User, UserContext, UserQuery> = {
  // ...
  onSync,
};
```

### Handler Mode

```typescript
const { onSync } = createSyncClient<User>({
  fetch: async (query, signal) => fetchUsers(query),
  create: async (data, signal) => {
    const id = await createUser(data);
    return syncSuccess({ newId: id });
  },
  update: async (id, data, signal) => {
    await updateUser(id, data);
    return syncSuccess();
  },
  delete: async (id, data, signal) => {
    await deleteUser(id);
    return syncSuccess();
  },
});
```

## Server

```typescript
const usersServer = createSyncServer<User, UserQuery>({
  schema: UserSchema,           // optional: zod schema for data validation
  querySchema: UserQuerySchema, // optional: zod schema for query validation

  fetch: (query, ctx) => db.users.findMany({ ... }),
  create: (data, ctx) => {
    const user = db.users.create({ data });
    return serverSyncSuccess({ newId: user.id });
  },
  update: (id, data, ctx) => {
    db.users.update({ where: { id }, data });
    return serverSyncSuccess();
  },
  delete: (id, data, ctx) => {
    db.users.delete({ where: { id } });
    return serverSyncSuccess();
  },
});

// Framework integration
app.post("/api/users/sync", (c) => usersServer.handler(c.req.raw)); // Hono
export const POST = usersServer.handler; // Next.js
```

## Request/Response Format

```typescript
// Request (POST)
{ query?: Q, changes?: Change<T>[] }

// Response
{ results?: T[], syncResults?: SyncResult[] }
```

## Types

```typescript
type SyncHandlerResult = { success: true; newId?: string } | { success: false; error: string };

type SyncClientConfig<T, Q> = {
  endpoint?: string;
  headers?: Record<string, string>;
  fetch?: (query: Q, signal: AbortSignal) => Promise<T[]>;
  create?: (data: T, signal: AbortSignal) => Promise<SyncHandlerResult>;
  update?: (id: string, data: T, signal: AbortSignal) => Promise<SyncHandlerResult>;
  delete?: (id: string, data: T, signal: AbortSignal) => Promise<SyncHandlerResult>;
};

type SyncServerConfig<T, Q> = {
  schema?: Schema<T>;
  querySchema?: Schema<Q>;
  fetch?: (query: Q, ctx: { body }) => Promise<T[]> | T[];
  create?: (data: T, ctx: { body }) => Promise<SyncHandlerResult> | SyncHandlerResult;
  update?: (id: string, data: T, ctx: { body }) => Promise<SyncHandlerResult> | SyncHandlerResult;
  delete?: (id: string, data: T, ctx: { body }) => Promise<SyncHandlerResult> | SyncHandlerResult;
};
```
