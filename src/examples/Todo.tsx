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
  fetch: async ({ signal }) => {
    await wait(2000, signal);
    return {
      items: await fetch("https://jsonplaceholder.typicode.com/todos")
        .then((r) => r.json())
        .then((items) => items.slice(0, 10)),
      metadata: { complete: "..." },
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
  const { items, fetchState } = useCrud(TodoCrud);
  console.log(fetchState);
  if (fetchState.isLoading) {
    return <div className="p-5">Loading...</div>;
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
