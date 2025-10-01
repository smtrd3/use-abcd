import React, { useCallback } from "react";
import { useCrud, type CrudConfig, type ItemWithState, type Updater } from "../useCrud";
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
        { id: "1", description: "Shop for electronics", complete: false },
        { id: "2", description: "Find time for learning", complete: false },
        { id: "3", description: "Pick stocks", complete: false },
        { id: "4", description: "Pick stocks", complete: false },
      ],
      metadata: {},
    };
  },
};

const Item = React.memo(function Item(props: {
  item: ItemWithState<Todo>;
  update: (item: ItemWithState<Todo>, updater: Updater<Todo>, isOptimistic?: boolean) => void;
}) {
  const { update, item } = props;
  const { data } = item;

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

export const Todo = React.memo(function Todo() {
  const { items, isLoading, update } = useCrud(TodoCrud);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="p-2">
      {map(items, (item) => (
        <Item key={item.data.id} item={item} update={update} />
      ))}
    </div>
  );
});
