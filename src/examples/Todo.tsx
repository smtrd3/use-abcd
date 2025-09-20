import React, { useCallback } from "react";
import { useCrud, useCrudOperations, type CrudConfig, type ItemWithState } from "../useCrud";
import { map } from "lodash-es";

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
