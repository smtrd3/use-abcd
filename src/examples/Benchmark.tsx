import React, { useCallback, useState, useRef } from "react";
import { useCrud, type Config } from "../useCrud";
import { createSyncClient } from "../runtime/client";
import { useItem } from "../useItem";
import type { Item } from "../item";

interface Address {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

interface AddressContext {
  count: number;
}

const ITEM_COUNTS = [1000, 5000, 10000] as const;

function makeConfig(count: number): Config<Address, AddressContext> {
  return {
    id: `benchmark-${count}`,
    initialContext: { count },
    syncDebounce: 500,
    syncRetries: 3,
    handler: createSyncClient<Address, AddressContext>("/api/addresses"),
  };
}

const configs = Object.fromEntries(
  ITEM_COUNTS.map((c) => [c, makeConfig(c)]),
) as Record<(typeof ITEM_COUNTS)[number], Config<Address, AddressContext>>;

// --- Individual address row ---

const AddressRow = React.memo(function AddressRow({
  item,
  onSelect,
  isSelected,
}: {
  item: Item<Address, AddressContext>;
  onSelect: (id: string) => void;
  isSelected: boolean;
}) {
  const { data, status, update, remove } = useItem(item);

  const handleUpdate = useCallback(() => {
    update((draft) => {
      draft.street = `${Math.floor(Math.random() * 9999)} Updated St`;
    });
  }, [update]);

  const handleRemove = useCallback(() => {
    remove();
  }, [remove]);

  if (!data) return null;

  return (
    <tr
      className={`border-b text-sm cursor-pointer ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}`}
      onClick={() => onSelect(data.id)}
    >
      <td className="px-3 py-2 font-mono text-gray-400 w-16">{data.id}</td>
      <td className="px-3 py-2">{data.name}</td>
      <td className="px-3 py-2">{data.street}</td>
      <td className="px-3 py-2">{data.city}</td>
      <td className="px-3 py-2 w-12">{data.state}</td>
      <td className="px-3 py-2 w-20">{data.zip}</td>
      <td className="px-3 py-2 w-20">
        {status && (
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              status.status === "syncing"
                ? "bg-blue-100 text-blue-700"
                : status.status === "pending"
                  ? "bg-yellow-100 text-yellow-700"
                  : status.status === "error"
                    ? "bg-red-100 text-red-700"
                    : ""
            }`}
          >
            {status.status !== "success" ? status.status : ""}
          </span>
        )}
      </td>
      <td className="px-3 py-2 w-28">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleUpdate();
            }}
            className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded hover:bg-blue-600"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRemove();
            }}
            className="text-xs bg-red-500 text-white px-2 py-0.5 rounded hover:bg-red-600"
          >
            Del
          </button>
        </div>
      </td>
    </tr>
  );
});

// --- Main benchmark component ---

export const Benchmark = React.memo(function Benchmark() {
  const [count, setCount] = useState<(typeof ITEM_COUNTS)[number]>(1000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const renderCountRef = useRef(0);
  renderCountRef.current++;

  const config = configs[count];

  const { items, loading, syncing, syncQueue, getItem, refresh, remove } =
    useCrud<Address, AddressContext>(config);

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(items.keys()).slice(0, 10);
    for (const id of ids) {
      remove(id);
    }
  }, [items, remove]);

  const handleRandomUpdate = useCallback(() => {
    const keys = Array.from(items.keys());
    const randomIdx = Math.floor(Math.random() * keys.length);
    const id = keys[randomIdx];
    const item = getItem(id);
    if (item.data) {
      item.update((draft) => {
        draft.street = `${Math.floor(Math.random() * 9999)} Random Blvd`;
      });
    }
  }, [items, getItem]);

  const addressList = Array.from(items.values());

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Benchmark</h1>

      {/* Controls */}
      <div className="bg-gray-100 p-4 rounded mb-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Count selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Items:</span>
            {ITEM_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setCount(n);
                }}
                className={`px-3 py-1 rounded text-sm ${
                  count === n ? "bg-blue-500 text-white" : "bg-white border hover:bg-gray-50"
                }`}
              >
                {n.toLocaleString()}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-gray-300" />

          {/* Actions */}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="text-sm bg-gray-300 px-3 py-1 rounded hover:bg-gray-400 disabled:opacity-50"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={handleRandomUpdate}
            disabled={loading || items.size === 0}
            className="text-sm bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            Random Update
          </button>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={loading || items.size === 0}
            className="text-sm bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 disabled:opacity-50"
          >
            Delete First 10
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-4 mt-3 text-sm text-gray-600">
          <span>Rendered: {addressList.length.toLocaleString()} rows</span>
          <span>Renders: #{renderCountRef.current}</span>
          {syncing && <span className="text-blue-600">Syncing...</span>}
          {syncQueue.queue.size > 0 && (
            <span className="text-yellow-600">Queue: {syncQueue.queue.size}</span>
          )}
          {syncQueue.errors.size > 0 && (
            <span className="text-red-600">Errors: {syncQueue.errors.size}</span>
          )}
        </div>
      </div>

      {/* Selected item detail */}
      {selectedId && items.has(selectedId) && (
        <SelectedDetail item={getItem(selectedId)} onDeselect={() => setSelectedId(null)} />
      )}

      {/* Table */}
      {loading && addressList.length === 0 ? (
        <div className="text-center py-12 text-gray-500">Loading {count.toLocaleString()} addresses...</div>
      ) : (
        <div className="border rounded overflow-auto max-h-[600px]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-xs text-gray-500 uppercase">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Street</th>
                <th className="px-3 py-2">City</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Zip</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {addressList.map((addr) => (
                <AddressRow
                  key={addr.id}
                  item={getItem(addr.id)}
                  onSelect={handleSelect}
                  isSelected={selectedId === addr.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

// --- Selected item detail panel ---

const SelectedDetail = React.memo(function SelectedDetail({
  item,
  onDeselect,
}: {
  item: Item<Address, AddressContext>;
  onDeselect: () => void;
}) {
  const { data, status, update } = useItem(item);

  const [editName, setEditName] = useState("");
  const [editStreet, setEditStreet] = useState("");
  const [editing, setEditing] = useState(false);

  const startEdit = useCallback(() => {
    if (data) {
      setEditName(data.name);
      setEditStreet(data.street);
      setEditing(true);
    }
  }, [data]);

  const saveEdit = useCallback(() => {
    update((draft) => {
      draft.name = editName;
      draft.street = editStreet;
    });
    setEditing(false);
  }, [update, editName, editStreet]);

  if (!data) return null;

  return (
    <div className="bg-white border rounded p-4 mb-4">
      <div className="flex justify-between items-start mb-3">
        <h3 className="font-bold">Selected: #{data.id}</h3>
        <button
          type="button"
          onClick={onDeselect}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          Close
        </button>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="border px-2 py-1 rounded text-sm"
            placeholder="Name"
          />
          <input
            type="text"
            value={editStreet}
            onChange={(e) => setEditStreet(e.target.value)}
            className="border px-2 py-1 rounded text-sm"
            placeholder="Street"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              className="text-sm bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-sm bg-gray-300 px-3 py-1 rounded hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm">
          <p>
            <strong>Name:</strong> {data.name}
          </p>
          <p>
            <strong>Address:</strong> {data.street}, {data.city}, {data.state} {data.zip}
          </p>
          {status && status.status !== "success" && (
            <p className="mt-1">
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  status.status === "syncing"
                    ? "bg-blue-100 text-blue-700"
                    : status.status === "pending"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-red-100 text-red-700"
                }`}
              >
                {status.status}
              </span>
            </p>
          )}
          <button
            type="button"
            onClick={startEdit}
            className="mt-2 text-sm bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
});
