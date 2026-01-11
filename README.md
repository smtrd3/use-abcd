# use-abcd (alpha)

[![Build Status](https://github.com/smtrd3/common-state/workflows/CI/badge.svg)](https://github.com/smtrd3/common-state/actions)

Most apps on the internet are some form of CRUD - whether it's a todo list, a dashboard, or a social media feed. Yet we often find ourselves fighting with complex state management frameworks, reinventing patterns for each project. What if we inverted the problem? Instead of building custom state management, recognize that your app state is likely CRUD at its core. This library provides highly optimized, systematic CRUD state management that makes your code easier to reason about and your life as a developer much simpler. You don't need to invent state management for each app - chances are, it's just CRUD. And with built-in sync and offline-first capabilities, you get zero-latency UI updates and virtually no loading screens - your API integration becomes a breeze while users enjoy an instant, responsive experience.

A powerful React hook for managing ABCD (or CRUD) operations with optimistic updates, caching, and automatic state management.

> **Note on Package Name**: The package is published as `use-abcd` on npm due to naming availability, where ABCD stands for Add, Browse, Change, and Delete - which maps directly to the traditional CRUD (Create, Read, Update, Delete) operations. While the package name uses ABCD, all internal APIs and documentation use CRUD terminology for familiarity and consistency with common programming patterns.

## Features

- 🔄 Automatic state management with React 19 compatible hooks
- ⚡ Optimistic updates for instant UI feedback
- 🗄️ Built-in caching with configurable TTL and capacity
- 🎯 Type-safe with full TypeScript support
- ⏳ Debounced sync with configurable delays
- 🔄 Sync queue management with pause/resume/retry
- 🎨 Context-based filtering and pagination
- 🔌 End-to-end type-safe client-server sync utilities

## Installation

```bash
npm install use-abcd
# or
yarn add use-abcd
# or
bun add use-abcd
```

## Package Exports

The package provides multiple entry points:

```typescript
// Main package - React hooks and client-side sync utilities
import { useCrud, Collection, createSyncClient } from "use-abcd";

// Runtime client - Client & server sync utilities (for isomorphic code)
import { createSyncClient, createSyncServer } from "use-abcd/runtime/client";

// Runtime server - Server-side sync utilities only
import { createSyncServer, serverSyncSuccess } from "use-abcd/runtime/server";
```

## Quick Start

```typescript
import { useCrud, type Config } from "use-abcd";

interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

const TodoConfig: Config<Todo, {}> = {
  id: "todos",
  initialContext: {},
  getId: (item) => item.id,

  onFetch: async (context, signal) => {
    const response = await fetch("/api/todos", { signal });
    const data = await response.json();
    return data.items;
  },

  onSync: async (changes, signal) => {
    // Handle create, update, delete operations
    const results = [];
    for (const change of changes) {
      // Process each change and return results
      results.push({ id: change.id, status: "success" });
    }
    return results;
  },
};

function TodoList() {
  const { items, loading, create, update, remove } = useCrud(TodoConfig);

  // Use items, create, update, remove in your UI
}
```

## Core Concepts

### Config

The `Config` object defines how your data is fetched, synced, and managed:

```typescript
type Config<T extends object, C> = {
  id: string;                    // Unique identifier for this collection
  initialContext: C;             // Initial context (filters, pagination, etc.)
  getId: (item: T) => string;    // Extract ID from item
  setId?: (item: T, newId: string) => T;  // Optional: for ID remapping on create

  // Optional sync configuration
  syncDebounce?: number;         // Debounce delay for sync (default: 300ms)
  syncRetries?: number;          // Max retry attempts (default: 3)

  // Optional cache configuration
  cacheCapacity?: number;        // Max cache entries (default: 10)
  cacheTtl?: number;            // Cache TTL in ms (default: 60000)

  // Required handlers
  onFetch: (context: C, signal: AbortSignal) => Promise<T[]>;
  onSync?: (changes: Change<T>[], signal: AbortSignal) => Promise<SyncResult[]>;
};
```

### Hook API

The `useCrud` hook returns:

```typescript
{
  // State
  items: Map<string, T>;         // Current items
  context: C;                    // Current context
  loading: boolean;              // Fetch loading state
  syncing: boolean;              // Sync in progress
  syncQueue: SyncQueueState<T>;  // Sync queue state

  // Item operations (optimistic)
  create: (item: T) => void;
  update: (id: string, mutate: (draft: T) => void) => void;
  remove: (id: string) => void;
  getItem: (id: string) => Item<T, C>;
  getItemStatus: (id: string) => ItemStatus | null;

  // Context & refresh
  setContext: (mutate: (draft: C) => void) => void;
  refresh: () => Promise<void>;

  // Sync controls
  pauseSync: () => void;
  resumeSync: () => void;
  retrySync: (id?: string) => void;
}
```

## Examples

The repository includes examples demonstrating various use cases:

- **Products** - Full CRUD with filtering, search, and error handling
- **Pagination** - Context-based pagination with dynamic page size
- **Optimistic Updates** - Comments with instant UI feedback and sync queue visualization
- **Blog Post** - Simple single-item editing
- **Todo List** - Basic list operations

Run locally: `bun run dev` or `npm run dev` and visit `http://localhost:5173`

## Advanced Usage

### Individual Item Management

Use `getItem()` with `useItem()` for managing individual items:

```typescript
import { useCrud, useItem } from "use-abcd";

function ProductList() {
  const { items, getItem } = useCrud(ProductsConfig);

  return (
    <div>
      {Array.from(items.keys()).map((id) => (
        <ProductItem key={id} item={getItem(id)} />
      ))}
    </div>
  );
}

function ProductItem({ item }: { item: Item<Product, ProductContext> }) {
  const { data, status, update, remove, exists } = useItem(item);

  if (!exists) return null;

  return (
    <div>
      <h3>{data?.name}</h3>
      <p>Status: {status?.status || "synced"}</p>
      <button onClick={() => update((draft) => { draft.stock += 1; })}>
        Add Stock
      </button>
      <button onClick={() => remove()}>Delete</button>
    </div>
  );
}
```

**Benefits:**
- `useItem()` subscribes only to that specific item's changes
- React re-renders only when that item's data changes (automatic optimization via WeakMap cache)
- Clean separation of list and item concerns

### Context-Based Filtering & Pagination

Use context to manage filters, pagination, sorting:

```typescript
interface ProductContext {
  page: number;
  limit: number;
  category?: string;
  search?: string;
}

const { items, context, setContext } = useCrud<Product, ProductContext>(config);

// Update context to refetch
setContext((draft) => {
  draft.category = "electronics";
  draft.page = 1;
});
```

### Sync Queue Monitoring

Track pending changes and errors:

```typescript
const { syncQueue, pauseSync, resumeSync, retrySync } = useCrud(config);

// Check queue state
console.log({
  pending: syncQueue.queue.size,
  inFlight: syncQueue.inFlight.size,
  errors: syncQueue.errors.size,
});

// Control sync
pauseSync();
resumeSync();
retrySync(); // Retry all failed items
retrySync(itemId); // Retry specific item
```

### ID Remapping for Optimistic Creates

Handle temporary IDs that get replaced by server-assigned IDs:

```typescript
onSync: async (changes, signal) => {
  for (const change of changes) {
    if (change.type === "create") {
      const response = await fetch("/api/items", {
        method: "POST",
        body: JSON.stringify(change.data),
        signal,
      });
      const data = await response.json();

      // Return newId to remap temp ID to server ID
      return {
        id: change.id,        // Temporary ID (e.g., "temp-123")
        status: "success",
        newId: data.id,       // Server-assigned ID (e.g., "456")
      };
    }
    // ... handle update and delete
  }
};
```

The library automatically:
1. Updates the item's key in the `items` Map
2. Updates the item's `id` property
3. Updates any `Item` references
4. Triggers UI re-render

## End-to-End Type-Safe CRUD with createSyncClient & createSyncServer

Build a complete type-safe CRUD solution with minimal boilerplate:

### Client Setup

```typescript
import { useCrud, createSyncClientFromEndpoint } from "use-abcd";

interface User {
  id: string;
  name: string;
  email: string;
}

interface UserQuery {
  page: number;
  limit: number;
  search?: string;
}

const UserConfig: Config<User, UserQuery> = {
  id: "users",
  initialContext: { page: 1, limit: 10 },
  getId: (user) => user.id,

  // Use createSyncClientFromEndpoint for unified fetch + sync
  ...createSyncClientFromEndpoint<User, UserQuery>("/api/users"),
};

function UserList() {
  const { items, loading, create, update, remove, setContext } = useCrud(UserConfig);

  return (
    <div>
      {loading ? <p>Loading...</p> : (
        <>
          {Array.from(items.values()).map((user) => (
            <div key={user.id}>
              <span>{user.name} - {user.email}</span>
              <button onClick={() => update(user.id, (draft) => {
                draft.name = "Updated Name";
              })}>
                Update
              </button>
              <button onClick={() => remove(user.id)}>Delete</button>
            </div>
          ))}
          <button onClick={() => create({
            id: `temp-${Date.now()}`,
            name: "New User",
            email: "new@example.com",
          })}>
            Add User
          </button>
        </>
      )}
    </div>
  );
}
```

### Server Setup

```typescript
import { createSyncServer, serverSyncSuccess } from "use-abcd/runtime/server";

// Define your handlers
const usersHandler = createSyncServer<User, UserQuery>({
  fetch: async (query) => {
    // Handle pagination and search
    return db.users.findMany({
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      where: query.search ? { name: { contains: query.search } } : undefined,
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

// Use with your framework
// Next.js App Router
export const POST = usersHandler.handler;

// Hono
app.post("/api/users", (c) => usersHandler.handler(c.req.raw));

// Bun.serve
Bun.serve({
  fetch(req) {
    if (new URL(req.url).pathname === "/api/users") {
      return usersHandler.handler(req);
    }
  }
});
```

### What You Get

- **Type safety**: Full TypeScript inference from data types to API calls
- **Automatic ID remapping**: Temporary IDs are replaced with server-assigned IDs
- **Batch operations**: Multiple changes are sent in a single request
- **Optimistic updates**: UI updates instantly, syncs in background
- **Error handling**: Failed operations are tracked and can be retried
- **Unified endpoint**: Single POST endpoint handles fetch + create/update/delete

### Request/Response Format

```typescript
// Fetch + Sync in one request
POST /api/users
Body: {
  query: { page: 1, limit: 10, search: "john" },
  changes: [
    { id: "temp-123", type: "create", data: { ... } },
    { id: "456", type: "update", data: { ... } },
    { id: "789", type: "delete", data: { ... } }
  ]
}

Response: {
  results: [...users],  // Fetched items
  syncResults: [        // Sync results
    { id: "temp-123", status: "success", newId: "999" },
    { id: "456", status: "success" },
    { id: "789", status: "success" }
  ]
}
```

## API Reference

### Types

```typescript
type Config<T extends object, C> = {
  id: string;
  initialContext: C;
  getId: (item: T) => string;
  setId?: (item: T, newId: string) => T;
  syncDebounce?: number;
  syncRetries?: number;
  cacheCapacity?: number;
  cacheTtl?: number;
  onFetch: (context: C, signal: AbortSignal) => Promise<T[]>;
  onSync?: (changes: Change<T>[], signal: AbortSignal) => Promise<SyncResult[]>;
};

type Change<T> = {
  id: string;
  type: "create" | "update" | "delete";
  data: T;
};

type SyncResult = {
  id: string;
  status: "success" | "error";
  error?: string;
  newId?: string;  // For creates: server-assigned ID
};

type ItemStatus = {
  type: "create" | "update" | "delete";
  status: "pending" | "syncing" | "success" | "error";
  retries: number;
  error?: string;
} | null;
```

## Best Practices

1. **Use Optimistic Updates** - Let users see changes immediately while syncing in the background
2. **Handle Errors Gracefully** - Show error states and provide retry mechanisms
3. **Leverage Context** - Use context for filters, pagination, and search to trigger automatic refetches
4. **Use getItem() + useItem()** - For individual item management with automatic React optimization
5. **Monitor Sync Queue** - Display pending changes and errors to users for transparency
6. **Use createSyncClient/Server** - For end-to-end type-safe CRUD with minimal boilerplate

## Architecture

The library is built on several core concepts:

- **Collection** - Manages the item collection, sync queue, and fetch handler
- **SyncQueue** - Handles debounced synchronization with retry logic
- **FetchHandler** - Manages data fetching with caching
- **Item** - Represents individual items with WeakMap-based caching for React optimization

All state updates use [Mutative](https://github.com/unadlib/mutative) for immutable updates, ensuring React can efficiently detect changes.

## Contributing

This is an alpha release. Please read the source code for a deeper understanding of its implementation and capabilities. Contributions and feedback are welcome!

## License

MIT
