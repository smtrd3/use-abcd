# use-abcd (alpha)

[![Build Status](https://github.com/smtrd3/common-state/workflows/CI/badge.svg)](https://github.com/smtrd3/common-state/actions)

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
type Config<T, C> = {
  id: string;                    // Unique identifier for this collection
  initialContext: C;             // Initial context (filters, pagination, etc.)
  getId: (item: T) => string;    // Extract ID from item

  // Optional sync configuration
  syncDebounce?: number;         // Debounce delay for sync (default: 300ms)
  syncRetries?: number;          // Max retry attempts (default: 3)

  // Optional cache configuration
  cacheCapacity?: number;        // Max cache entries (default: 10)
  cacheTtl?: number;            // Cache TTL in ms (default: 60000)

  // Required handlers
  onFetch: (context: C, signal: AbortSignal) => Promise<T[]>;
  onSync: (changes: Change<T>[], signal: AbortSignal) => Promise<SyncResult[]>;
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
  syncState: SyncState;          // Overall sync state

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

The repository includes comprehensive examples demonstrating various use cases:

### 1. Full CRUD Operations (Products Example)

Demonstrates complete CRUD functionality with:
- Create, read, update, delete operations
- Category filtering and search
- Sync queue management
- Error handling with retries
- Per-item status indicators

```typescript
const ProductsConfig: Config<Product, ProductContext> = {
  id: "products",
  initialContext: { page: 1, limit: 10 },
  getId: (item) => item.id,

  onFetch: async (context, signal) => {
    const params = new URLSearchParams({
      page: String(context.page),
      limit: String(context.limit),
    });
    if (context.category) params.append("category", context.category);
    if (context.search) params.append("search", context.search);

    const response = await fetch(`/api/products?${params}`, { signal });
    return (await response.json()).items;
  },

  onSync: async (changes, signal) => {
    // Handle batch sync operations
  },
};
```

**Key features:**
- Filtering by category
- Text search
- Pause/resume sync
- Retry failed operations
- Visual status indicators

### 2. Pagination (Users Example)

Shows context-based pagination with:
- Dynamic page size selection
- Next/previous navigation
- Context updates trigger re-fetch

```typescript
interface UserContext {
  page: number;
  limit: number;
}

const { items, context, setContext } = useCrud<User, UserContext>(UsersConfig);

// Change page
setContext((draft) => {
  draft.page += 1;
});

// Change items per page
setContext((draft) => {
  draft.limit = 20;
  draft.page = 1; // Reset to first page
});
```

**Key features:**
- Configurable page size
- Context-based pagination
- Automatic re-fetch on context change

### 3. Optimistic Updates (Comments Example)

Demonstrates the power of optimistic updates:
- Instant UI feedback
- Background synchronization
- Sync queue visualization
- Manual retry controls
- Error state handling

```typescript
const CommentsConfig: Config<Comment, CommentContext> = {
  id: "comments-optimistic",
  initialContext: { postId: "1" },
  getId: (item) => item.id,
  syncDebounce: 100, // Very short debounce for demo

  // ... handlers
};

// Create appears instantly in UI
create({
  id: `temp-${Date.now()}`,
  text: "New comment",
  author: "You",
  createdAt: new Date().toISOString(),
});
```

**Key features:**
- Immediate UI updates
- Sync queue status display
- Pause/resume synchronization
- Per-item sync status
- Manual retry for errors

### 4. Original Examples

The repository also includes the original simpler examples:
- **Blog Post**: Single item editing with optimistic updates
- **Todo List**: Simple list with toggle completion

## Advanced Usage

### Custom Context for Filtering

Use context to manage filters, pagination, sorting, etc.:

```typescript
interface ProductContext {
  page: number;
  limit: number;
  category?: string;
  search?: string;
  sortBy?: "name" | "price";
}

const { context, setContext } = useCrud<Product, ProductContext>(config);

// Update multiple context fields
setContext((draft) => {
  draft.category = "electronics";
  draft.page = 1;
});
```

### Monitoring Sync Queue

Track pending changes and errors:

```typescript
const { syncQueue, pauseSync, resumeSync, retrySync } = useCrud(config);

console.log({
  pending: syncQueue.queue.size,
  inFlight: syncQueue.inFlight.size,
  errors: syncQueue.errors.size,
  isPaused: syncQueue.isPaused,
  isSyncing: syncQueue.isSyncing,
});

// Pause sync temporarily
pauseSync();

// Resume sync
resumeSync();

// Retry specific item
retrySync(itemId);

// Retry all failed items
retrySync();
```

### Per-Item Status

Track the sync status of individual items:

```typescript
const { getItemStatus } = useCrud(config);

const status = getItemStatus(itemId);
if (status) {
  console.log({
    type: status.type,        // "create" | "update" | "delete"
    status: status.status,    // "pending" | "syncing" | "success" | "error"
    retries: status.retries,  // Number of retry attempts
    error: status.error,      // Error message if failed
  });
}
```

### ID Remapping for Optimistic Creates

When creating items optimistically, you typically use a temporary ID (e.g., `temp-${Date.now()}`). After the server confirms the creation, it may assign a different permanent ID. The library automatically handles this ID remapping.

**In your `onSync` handler**, return the server-assigned `newId` for create operations:

```typescript
onSync: async (changes, signal) => {
  const results: SyncResult[] = [];

  for (const change of changes) {
    if (change.type === "create") {
      const response = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change.data),
        signal,
      });

      if (!response.ok) throw new Error("Failed to create");

      const data = await response.json();
      // Return newId to remap the temporary ID to the server-assigned ID
      results.push({
        id: change.id,        // The temporary ID
        status: "success",
        newId: data.id,       // The server-assigned permanent ID
      });
    }
    // ... handle update and delete
  }

  return results;
};
```

**What happens automatically:**
1. The item's key in the `items` Map is updated from `temp-123` to `server-456`
2. The item's `id` property is updated (assumes item has an `id` field)
3. Any `Item` references are updated to use the new ID
4. The UI re-renders with the correct permanent ID

**Custom ID field**: If your item uses a different property for the ID (not `id`), provide a `setId` function in your config:

```typescript
const config: Config<MyItem, Context> = {
  getId: (item) => item.itemId,
  setId: (item, newId) => ({ ...item, itemId: newId }),
  // ...
};
```

### Cache Control

Control caching behavior:

```typescript
const config: Config<T, C> = {
  // ...
  cacheCapacity: 20,  // Store up to 20 cache entries
  cacheTtl: 30000,    // Cache expires after 30 seconds
};

const { refresh } = useCrud(config);

// Force refresh (bypass cache)
await refresh();
```

## Running Examples Locally

The repository includes a development environment with MSW (Mock Service Worker) for testing:

```bash
# Clone the repository
git clone https://github.com/smtrd3/use-abcd
cd use-abcd

# Install dependencies
bun install  # or npm install

# Start development server
bun run dev  # or npm run dev
```

Visit `http://localhost:5173` to see the examples in action.

### Available Examples:

1. **Products (Full CRUD)** - Complete CRUD operations with filtering
2. **Pagination** - Context-based pagination with users
3. **Optimistic Updates** - Comments with sync queue visualization
4. **Blog Post (Original)** - Simple single-item editing
5. **Todo (Original)** - Basic list operations

## API Reference

### Types

```typescript
// Main configuration
type Config<T, C> = {
  id: string;
  initialContext: C;
  getId: (item: T) => string;
  setId?: (item: T, newId: string) => T;  // Optional: for ID remapping on create
  syncDebounce?: number;
  syncRetries?: number;
  cacheCapacity?: number;
  cacheTtl?: number;
  onFetch: (context: C, signal: AbortSignal) => Promise<T[]>;
  onSync: (changes: Change<T>[], signal: AbortSignal) => Promise<SyncResult[]>;
};

// Change type for sync operations
type Change<T> = {
  id: string;
  type: "create" | "update" | "delete";
  data: T;
};

// Sync result
type SyncResult = {
  id: string;
  status: "success" | "error";
  error?: string;
  newId?: string;  // For create operations: server-assigned ID to replace temp ID
};

// Item status
type ItemStatus = {
  type: "create" | "update" | "delete";
  status: "pending" | "syncing" | "success" | "error";
  retries: number;
  error?: string;
} | null;

// Sync queue state
type SyncQueueState<T> = {
  queue: Map<string, Change<T>>;        // Pending changes
  inFlight: Map<string, Change<T>>;     // Currently syncing
  errors: Map<string, { error: string; retries: number }>;
  isPaused: boolean;
  isSyncing: boolean;
};
```

## Best Practices

1. **Use Optimistic Updates**: Let users see changes immediately while syncing in the background
2. **Handle Errors Gracefully**: Show error states and provide retry mechanisms
3. **Configure Debouncing**: Adjust `syncDebounce` based on your use case
4. **Leverage Context**: Use context for filters, pagination, and search
5. **Monitor Sync Queue**: Display pending changes and errors to users
6. **Cache Wisely**: Configure `cacheTtl` and `cacheCapacity` based on your data freshness requirements

## Architecture

The library is built on several core concepts:

- **Collection**: Manages the item collection, sync queue, and fetch handler
- **SyncQueue**: Handles debounced synchronization with retry logic
- **FetchHandler**: Manages data fetching with caching
- **Item**: Represents individual items with their sync state

All state updates use [Mutative](https://github.com/unadlib/mutative) for immutable updates, ensuring React can efficiently detect changes.

## Contributing

This is an alpha release. Please read the source code for a deeper understanding of its implementation and capabilities. Contributions and feedback are welcome!

## License

MIT