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
// biome-ignore assist/source/organizeImports: useless
import React, { useCallback } from "react";
import { useCrud, useItemState, type CrudConfig, type ItemWithState } from "../useCrud";
import { map } from "lodash-es";
import { wait } from "../utils";

type Todo = {
  userId: string;
  id: string;
  title: string;
  completed: boolean;
};

const TodoCrud: CrudConfig<Todo> = {
  id: "todo-crud",
  context: {},
  caching: {
    age: 5000000,
    capacity: 10,
  },
  fetch: async () => {
    return {
      items: await fetch("https://jsonplaceholder.typicode.com/todos")
        .then((r) => r.json())
        .then((items) => items.slice(0, 10)),
      metadata: {},
    };
  },
  update: async (item, { signal }) => {
    await wait(1000, signal);
    return { id: item.id };
  },
};

const Item = React.memo(function Item(props: { item: ItemWithState<Todo> }) {
  const { item } = props;
  const [data, { update, states }] = useItemState("todo-crud", item);

  const markComplete = useCallback(() => {
    update((draft) => {
      draft.completed = !data.completed;
    });
  }, [update, data]);

  return (
    <div key={data.id} className="flex justify-between gap-2 mb-1 min-w-[500px]">
      <div
        className={
          data.completed ? "line-through font-bold text-gray-700" : "font-bold text-gray-700"
        }
      >
        {data.title}
      </div>
      <button
        type="button"
        className="bg-blue-300 px-2 rounded active:bg-blue-400 cursor-pointer font-bold disabled:opacity-40"
        onClick={markComplete}
        disabled={states.has("update")}
      >
        {states.has("update")
          ? "Updating..."
          : data.completed
          ? "Mark incomplete"
          : "Mark complete"}
      </button>
    </div>
  );
});

export const Todo = React.memo(function Todo() {
  const {
    items,
    fetchState: { isLoading },
  } = useCrud(TodoCrud);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h2 className="font-bold text-3xl mt-4">Todo with useCrud()</h2>
      <div className="p-2">
        {map(items, (item) => (
          <Item key={item.data.id} item={item} />
        ))}
      </div>
    </div>
  );
});
```

> **Note**: This is a single-file library with a focused scope. Please read the source code for a deeper understanding of its implementation and capabilities.

## License

MIT
