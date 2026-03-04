# use-abcd

State management library purpose-built for CRUD applications. Manages collections of records with optimistic mutations, automatic syncing, and built-in retry logic. Includes a fullstack component for implementing state synchronization between client and server.

```
npm install use-abcd
```

## Basic Usage

A collection is defined by a `Config` object with an `id`, an `initialContext` (the query parameters), and a `handler` that fetches and syncs data.

```ts
import { useCrud, createSyncClient } from "use-abcd";

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

interface Query {
  status: "all" | "active" | "done";
}

const config = {
  id: "todos",
  initialContext: { status: "all" } as Query,
  handler: createSyncClient<Todo, Query>("/api/todos"),
};
```

The `handler` is a single function that serves both fetching and syncing. When the collection needs data it calls the handler with `{ query }`. When local mutations need to be pushed it calls with `{ changes }`. `createSyncClient` creates a handler that talks to a remote endpoint over HTTP.

### `useCrud`

The main hook. Returns the collection's items, state flags, and mutation functions.

```tsx
function TodoApp() {
  const {
    items,        // Map<string, Todo>
    loading,      // true during initial fetch
    syncing,      // true while pushing changes
    context,      // current query context
    create,       // (item: Omit<Todo, "id">) => string
    update,       // (id, (draft) => void) => void
    remove,       // (id) => void
    setContext,   // (mutator) => void — triggers refetch
    getItem,      // (id) => Item<Todo>
    getItemStatus,// (id) => ItemStatus | null
    refresh,      // () => Promise<void>
    pauseSync,    // () => void
    resumeSync,   // () => void
    retrySync,    // (id?) => void
  } = useCrud(config);

  // ...render
}
```

Mutations are optimistic — `create`, `update`, and `remove` update local state immediately and queue changes for sync in the background. The sync queue batches changes, debounces flushes, and retries on failure.

### `useItem`

Subscribe to a single item without re-rendering on unrelated changes. Takes an `Item` reference from `getItem`.

```tsx
function TodoRow({ item }: { item: Item<Todo> }) {
  const { data, status, update, remove, exists } = useItem(item);

  // ...render
}
```

### Context

Context drives the query sent to the handler on fetch. Changing it triggers a refetch.

```tsx
setContext((draft) => {
  draft.status = "active";
});
```

### Config Options

```ts
{
  id: string;               // unique collection identifier
  initialContext: C;         // starting query state
  handler?: CrudHandler;    // fetch + sync function
  serverItems?: T[];        // initial items for SSR hydration

  // Sync
  syncDebounce?: number;    // ms, default 300
  syncRetries?: number;     // default 3
  refetchOnMutation?: boolean; // refetch after create/delete, default false

  // Cache
  cacheCapacity?: number;   // context cache slots, default 10
  cacheTtl?: number;        // ms, default 60000

  // Fetch
  fetchRetries?: number;    // default 0
}
```

## Tree State

The library supports tree-shaped state using `useCrudTree`. Nodes are stored as a flat key-value map internally, with parent-child relationships encoded in the node IDs using a separator (default `.`). A node with id `root.settings.theme` is a child of `root.settings`.

```ts
import { useCrudTree, type TreeConfig } from "use-abcd";

interface FieldValue {
  label: string;
}

type NodeType = "object" | "array" | "primitive";

const config: TreeConfig<FieldValue, {}, NodeType> = {
  id: "tree-editor",
  initialContext: {},
  rootId: "root",
  // nodeSeparator: ".", // default
  handler: createSyncClient("/api/tree"),
};
```

### `useCrudTree`

Returns the root node, selection state, serialization, and all the standard sync controls.

```tsx
function TreeEditor() {
  const {
    rootNode,       // Node | null
    selectedNode,   // Node | null
    selectedNodeId, // string | null
    selectNode,     // (id) => void
    deselectNode,   // () => void
    getNode,        // (id) => Node
    toJson,         // () => object | null
    // ...same sync controls as useCrud
  } = useCrudTree(config);

  // ...render
}
```

### `useNode`

Subscribe to a single tree node. Provides navigation, mutation, and reordering operations.

```tsx
function TreeNodeRow({ node }: { node: Node<FieldValue, {}, NodeType> }) {
  const {
    data,        // TreeNode<FieldValue, NodeType> | undefined
    children,    // Node[]
    depth,       // nesting level
    exists,      // boolean
    isSelected,  // boolean
    status,      // ItemStatus

    // Tree mutations
    append,      // (value, type?) => string — add child at end
    prepend,     // (value, type?) => string — add child at start
    moveUp,      // () => void
    moveDown,    // () => void
    move,        // (position, targetParent?) => void — reparent
    clone,       // () => Map — deep clone subtree

    // Node mutations
    updateProp,  // (draft => void) => void — update value
    remove,      // () => void — remove node and descendants

    // Selection
    select,      // () => void
    deselect,    // () => void

    // Navigation
    getParent,   // () => Node | null
  } = useNode(node);

  // ...render
}
```

Each `TreeNode` stored in the collection has this shape:

```ts
{
  id: string;        // e.g. "root.settings.theme"
  position: number;  // sort order among siblings
  value: T;          // the node's data
  type: NodeType;    // e.g. "object" | "array" | "primitive"
}
```

### `useSelectedNode`

Convenience hook to access the currently selected node from anywhere, by collection ID.

```tsx
function Inspector() {
  const { data, isPresent } = useSelectedNode<FieldValue, {}, NodeType>("tree-editor");

  // ...render
}
```

## Server Contract

The library communicates with the server through a single `POST` endpoint. Every request and response follows a fixed shape.

### Request body

```ts
{
  scope?: string;           // optional namespace
  query?: Q;                // present on fetch requests
  changes?: Change<T>[];    // present on sync requests
}
```

A request contains `query` (to fetch data), `changes` (to push mutations), or both.

Each change:
```ts
{ id: string; type: "create" | "update" | "delete"; data: T }
```

### Response body

```ts
{
  serverSyncedAt: string;   // required — server timestamp (ULID)
  items?: T[];              // returned items from a fetch
  syncResults?: Result[];   // per-change results from a sync
  serverState?: S;          // optional server-side metadata
}
```

Each result:
```ts
{ id: string; type: ChangeType; status: "success" | "error"; serverSyncedAt: string; error?: string }
```

### Using the built-in runtime

The library ships client and server helpers that implement this contract.

**Client** — creates a `handler` for your config:

```ts
import { createSyncClient } from "use-abcd";

const handler = createSyncClient<Todo, Query>("/api/todos");
// or with options:
const handler = createSyncClient<Todo, Query>({
  endpoint: "/api/todos",
  headers: { Authorization: "Bearer ..." },
  scope: "workspace-123",
});
```

**Server** — creates a request handler from CRUD callbacks:

```ts
import { createCrudHandler, createSyncServer } from "use-abcd/runtime/server";

const handler = createSyncServer(
  createCrudHandler<Todo, Query>({
    fetch: ({ scope, query }) => {
      return db.todos.findMany({ where: { status: query.status } });
    },
    create: (record) => {
      db.todos.insert(record.data);
    },
    update: (record) => {
      db.todos.update(record.data.id, record.data);
    },
    remove: (record) => {
      db.todos.delete(record.data.id);
    },
  }),
);
```

`createSyncServer` returns a `(Request) => Promise<Response>` function compatible with any server that uses the Web Request/Response API (Bun, Deno, Cloudflare Workers, Next.js route handlers, etc.).

Each callback receives a `ServerRecord<T>`:
```ts
{ id: string; data: T; serverSyncedAt: string; deleted: boolean }
```

The `fetch` callback can return a plain array or an object with `items` and optional `serverState` for passing metadata (totals, pagination cursors, etc.) back to the client.

### Custom backend

If you are not using the built-in runtime, implement the POST endpoint yourself following the request/response shapes above. The key requirements:

1. Always return `serverSyncedAt` — a monotonically increasing string (ULIDs recommended). The client uses this for ordering and conflict detection.
2. Return `syncResults` for each change in the request. Each result must include the change's `id`, `type`, and a `status` of `"success"` or `"error"`. Missing results cause the sync queue to stall.
3. Return `items` when the request contains a `query`.
