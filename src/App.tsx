/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutative } from "use-mutative";
import { useCrud } from "./useCrud"
import React, { useState } from "react";

const Item = React.memo(function _Item(props: any) {
  console.log("Hello world!");

  return <div style={{ padding: '1em', display: 'flex', gap: 5, textDecoration: props.data.completed && 'line-through' }}>
    <span>{props.data.task}</span>
    <button onClick={() => props.remove(props.data)}>remove</button>
    <button onClick={() => {
      props.update(props.data, (draft) => {
        draft.completed = true;
      });
    }}>mark complete</button>
    </div>
});

let id = 0;

export function Container() {
  const [tab, setTab] = useState('one');

  return <div>
    {tab === 'one' ? <App id="one" /> : <App id="two" />}
    <div style={{ display: 'flex', gap: 3 }}>
      <button onClick={() => setTab('one')}>One</button>
      <button onClick={() => setTab('two')}>Two</button>
    </div>
  </div>;
}

function App(props: { id: string }) {
  const state = useCrud<{ id: string, task: string, completed: false }>({
    id: props.id,
    context: {},
    caching: {
      size: 10,
      time: 1000 * 60,
    },
    fetch: async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 1000);
      });

      return {
        items: [
          { id: '1', task: 'this is a simple task', completed: false },
          { id: '2', task: 'this task is not yet complete', completed: false }],
        metadata: {},
      }
    },
    create: async () => {
      return { id: 'id' + (id++) };
    }
  });
  const [newTodo, setNewTodo] = useMutative({ completed: false, task: '' });

  console.log(state);

  if (state.isLoading) {
    return <div>Loading...</div>
  }

  return (
    <div>
      {state.items.map(item => (<Item {...item} key={item.id} remove={state.remove} update={state.update} />))}
      <div>
        <input
          value={newTodo.task}
          onChange={e => {
            const value = e.target.value;
            setNewTodo(curr => {
              curr.task = value;
            });
          }}
        />
        <button onClick={() => {
          state.create({ task: newTodo.task, completed: false });
        }}>Add</button>
      </div>
    </div>
  )
}

export default App
