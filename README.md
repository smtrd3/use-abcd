# use-crud (alpha)

A powerful React hook for managing CRUD (Create, Read, Update, Delete) operations with optimistic updates, caching, and automatic state management.

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
npm install use-crud
# or
yarn add use-crud
# or
bun add use-crud
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
