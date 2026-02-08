# use-abcd

Optimized CRUD state management for React with built-in sync and offline-first support.

## Features

- Optimistic updates with automatic sync queue
- Built-in caching with configurable TTL
- Type-safe with full TypeScript support
- End-to-end client-server sync utilities

## Installation

```bash
npm install use-abcd
```

## Quick Start

```typescript
import { useCrud, createSyncClient, type Config } from "use-abcd";

interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

const { onSync } = createSyncClient<Todo>({ endpoint: "/api/todos/sync" });

const TodoConfig: Config<Todo, {}> = {
  id: "todos",
  initialContext: {},
  getId: (item) => item.id,
  onSync,
};

function TodoList() {
  const { items, create, update, remove } = useCrud(TodoConfig);

  return (
    <ul>
      {Array.from(items.values()).map((todo) => (
        <li key={todo.id}>
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => update(todo.id, (draft) => { draft.completed = !draft.completed; })}
          />
          {todo.title}
          <button onClick={() => remove(todo.id)}>Delete</button>
        </li>
      ))}
      <button onClick={() => create({ id: `temp-${Date.now()}`, title: "New", completed: false })}>
        Add
      </button>
    </ul>
  );
}
```

## Config

```typescript
type Config<T, C, Q = unknown> = {
  id: string;
  initialContext: C;
  getId: (item: T) => string;
  setId?: (item: T, newId: string) => T;

  syncDebounce?: number;  // default: 300ms
  syncRetries?: number;   // default: 3
  cacheCapacity?: number; // default: 10
  cacheTtl?: number;      // default: 60000ms

  parseQuery?: (context: C) => Q;
  onSync: (params: OnSyncParams<T, C, Q>) => Promise<OnSyncResult<T>>;
};

type OnSyncParams<T, C, Q> = {
  changes?: Change<T>[];
  query?: Q;
  signal: AbortSignal;
  context: C;
};

type OnSyncResult<T> = {
  queryResults: T[];
  syncResults: SyncResult[];
};
```

## Hook API

```typescript
const {
  items,      // Map<string, T>
  context,    // C
  loading,    // boolean
  syncing,    // boolean
  syncQueue,  // { queue, inFlight, errors, isPaused }

  create,     // (item: T) => void
  update,     // (id: string, mutate: (draft: T) => void) => void
  remove,     // (id: string) => void

  setContext, // (mutate: (draft: C) => void) => void
  refresh,    // () => Promise<void>

  pauseSync,  // () => void
  resumeSync, // () => void
  retrySync,  // (id?: string) => void
} = useCrud(config);
```

## Individual Item Hook

```typescript
import { useItem } from "use-abcd";

function TodoItem({ id }: { id: string }) {
  const { data, status, update, remove } = useItem<Todo>("todos", id);
  // Only re-renders when this specific item changes
}
```

## Server Setup

```typescript
import { createSyncServer, serverSyncSuccess } from "use-abcd/runtime/server";

const todosServer = createSyncServer<Todo>({
  fetch: (query, ctx) => db.todos.findMany(),
  create: (data, ctx) => {
    const todo = db.todos.create({ data });
    return serverSyncSuccess({ newId: todo.id });
  },
  update: (id, data, ctx) => {
    db.todos.update({ where: { id }, data });
    return serverSyncSuccess();
  },
  delete: (id, data, ctx) => {
    db.todos.delete({ where: { id } });
    return serverSyncSuccess();
  },
});

// Next.js / Hono / Bun
export const POST = todosServer.handler;
```

## Types

```typescript
type Change<T> = {
  id: string;
  type: "create" | "update" | "delete";
  data: T;
};

type SyncResult = {
  id: string;
  status: "success" | "error";
  error?: string;
  newId?: string;
};
```

## License

MIT
