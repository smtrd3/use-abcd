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
import React, { useCallback } from "react";
import { map } from "lodash-es";
import { useCrud, useCrudOperations, type CrudConfig, type ItemWithState } from "use-abcd";

type Todo = {
  id: string;
  description: string;
  complete: boolean;
};

const TodoCrud: CrudConfig<Todo> = {
  id: "todo-crud",
  context: {},
  caching: {
    age: 5000000,
    capacity: 10,
  },
  fetch: async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    return {
      items: [
        { id: "one", description: "Shop for electronics", complete: false },
        { id: "two", description: "Find time for learning", complete: false },
        { id: "three", description: "Pick stocks", complete: false },
      ],
      metadata: {},
    };
  },
};

const Item = React.memo((props: { item: ItemWithState<Todo> }) => {
  const item = props.item;
  const data = item.data;
  const { update } = useCrudOperations(TodoCrud);

  const markComplete = useCallback(() => {
    update(item, (draft) => {
      draft.complete = !item.data.complete;
    });
  }, [update, item]);

  return (
    <div key={data.id} className="flex gap-2 mb-1">
      <div className={data.complete ? "line-through" : ""}>{data.description}</div>
      <button
        className="bg-blue-300 px-2 rounded active:bg-blue-400 cursor-pointer font-bold"
        onClick={markComplete}
      >
        Complete
      </button>
    </div>
  );
});

export function Todo() {
  const { items, isLoading } = useCrud(TodoCrud);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="p-2">
      {map(items, (item) => (
        <Item item={item} />
      ))}
    </div>
  );
}
```

> **Note**: This is a single-file library with a focused scope. Please read the source code for a deeper understanding of its implementation and capabilities.

## License

MIT
