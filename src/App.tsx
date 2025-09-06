/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutative } from "use-mutative";
import { useCrud, useCrudOperations, type CrudConfig } from "./useCrud";
import React, { useState } from "react";

let _id = 1;
const getConfig = (id: string) =>
  ({
    id: id,
    context: {},
    caching: {
      capacity: 10,
      age: 1000 * 60,
    },
    fetch: async () => {
      console.log("Fetch called...");
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });

      return {
        items: [
          { id: "1", task: "Random id: " + Math.random(), completed: false },
          { id: "2", task: "Random id: " + Math.random(), completed: false },
        ],
        metadata: {},
      };
    },
    create: async () => {
      return { id: "id" + _id++ };
    },
  } satisfies CrudConfig<{ id: string; task: string; completed: false }>);

const Item = React.memo(function _Item(props: any) {
  console.log("Hello world!");

  return (
    <div
      style={{
        padding: "1em",
        display: "flex",
        gap: 5,
        textDecoration: props.data.completed && "line-through",
      }}
    >
      <span>{props.data.task}</span>
      <button onClick={() => props.remove(props.data)}>remove</button>
      <button
        onClick={() => {
          props.update(props.data, (draft) => {
            draft.completed = true;
          });
        }}
      >
        mark complete
      </button>
    </div>
  );
});

export function Container() {
  const [tab, setTab] = useState("one");
  const { refetch } = useCrudOperations(getConfig(tab));

  return (
    <div>
      <br />
      {tab === "one" ? <App id="one" /> : <App id="two" />}
      <br />
      <div style={{ display: "flex", gap: 5 }}>
        <button onClick={() => setTab("one")}>Route 1</button>
        <button onClick={() => setTab("two")}>Route 2</button>
        <button onClick={refetch}>Refetch</button>
      </div>
    </div>
  );
}

function App(props: { id: string }) {
  const state = useCrud<{ id: string; task: string; completed: false }>(getConfig(props.id));
  const [newTodo, setNewTodo] = useMutative({ completed: false, task: "" });

  console.log(state);

  if (state.isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      {state.items.map((item) => (
        <Item {...item} key={item.id} remove={state.remove} update={state.update} />
      ))}
      <div>
        <input
          value={newTodo.task}
          onChange={(e) => {
            const value = e.target.value;
            setNewTodo((curr) => {
              curr.task = value;
            });
          }}
        />
        <button
          onClick={() => {
            state.create({ task: newTodo.task, completed: false });
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default App;
