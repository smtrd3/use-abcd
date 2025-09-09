import { useCrud } from "./useCrud";

interface Counter {
  id: string;
  value: number;
  [key: string]: unknown;
}

/**
 * A simple counter example using useCrud hook
 * - Shows basic state management
 * - Demonstrates optimistic updates
 * - Includes data validation (no negative values)
 */
function App() {
  const { items, update, isLoading } = useCrud<Counter>({
    id: "counter",
    context: {},
    caching: {
      capacity: 1,
      age: 1000 * 60, // 1 minute
    },
    fetch: async () => ({
      items: [{ id: "main", value: 0 }],
      metadata: {},
    }),
    // persist data
    update: async (data: Counter) => ({
      ...data,
      value: Math.max(0, data.value),
    }),
  });

  const counter = items[0]?.data;

  if (isLoading || !counter) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ textAlign: "center", padding: "20px" }}>
      <h1 style={{ fontSize: "48px" }}>{counter.value}</h1>
      <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
        <button
          onClick={() =>
            update(counter, (draft) => {
              draft.value--;
            })
          }
          disabled={counter.value === 0}
        >
          -
        </button>
        <button
          onClick={() =>
            update(counter, (draft) => {
              draft.value++;
            })
          }
        >
          +
        </button>
      </div>
    </div>
  );
}

export default App;
