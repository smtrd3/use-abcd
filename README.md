# use-abcd (alpha)

[![Build Status](https://github.com/smtrd3/common-state/workflows/CI/badge.svg)](https://github.com/smtrd3/common-state/actions)

A powerful React hook for managing ABCD (or CRUD) operations with optimistic updates, caching, and automatic state management.

> **Note on Package Name**: The package is published as `use-abcd` on npm due to naming availability, where ABCD stands for Add, Browse, Change, and Delete - which maps directly to the traditional CRUD (Create, Read, Update, Delete) operations. While the package name uses ABCD, all internal APIs and documentation use CRUD terminology for familiarity and consistency with common programming patterns.

## Features

- 🔄 Automatic state management
- ⚡ Optimistic updates
- 🗄️ Built-in caching
- 🎯 Type-safe
- 🚫 Automatic error handling
- ⏳ Debounce support
- 🔍 Request cancellation

## Installation

```bash
npm install use-abcd
# or
yarn add use-abcd
# or
bun add use-abcd
```

## Quick Example

```typescript
import { useCrud } from "use-crud";

type Todo = {
  id: string;
  title: string;
  completed: boolean;
};

function TodoList() {
  const { items, isLoading, create, update, remove } = useCrud<Todo>({
    id: "todos",
    context: {},
    // Configure caching (optional)
    caching: {
      capacity: 10,
      age: 60000, // 1 minute
    },
    // Fetch todos from API
    fetch: async ({ signal }) => {
      const response = await fetch("https://api.example.com/todos", { signal });
      const items = await response.json();
      return { items, metadata: {} };
    },
    // Create new todo
    create: async (todo) => {
      const response = await fetch("https://api.example.com/todos", {
        method: "POST",
        body: JSON.stringify(todo),
      });
      const { id } = await response.json();
      return { id };
    },
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <button onClick={() => create({ title: "New Todo", completed: false })}>Add Todo</button>
      {items.map((item) => (
        <div key={item.data.id}>
          <span>{item.data.title}</span>
          <button
            onClick={() =>
              update(item.data, (draft) => {
                draft.completed = !draft.completed;
              })
            }
          >
            Toggle
          </button>
          <button onClick={() => remove(item.data)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
```

## License

MIT
