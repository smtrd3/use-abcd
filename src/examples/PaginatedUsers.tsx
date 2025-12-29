import React, { useCallback, useState, useEffect } from "react";
import { useCrud, type Config } from "../useCrud";
import { createSyncClient, fetchToSyncResult } from "../runtime";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface UserContext {
  page: number;
  limit: number;
}

interface PaginationMeta {
  total: number;
  hasMore: boolean;
}

// Store for pagination metadata (shared across renders)
let paginationMeta: PaginationMeta = { total: 0, hasMore: false };
const metaListeners: Set<() => void> = new Set();

const notifyMetaListeners = () => {
  metaListeners.forEach((listener) => listener());
};

const UsersConfig: Config<User, UserContext> = {
  id: "users-paginated",
  initialContext: {
    page: 1,
    limit: 5,
  },
  getId: (item) => item.id,

  syncDebounce: 300,
  syncRetries: 3,
  cacheCapacity: 10,
  cacheTtl: 60000,

  onFetch: async (context, signal) => {
    const params = new URLSearchParams({
      page: String(context.page),
      limit: String(context.limit),
    });

    const response = await fetch(`/api/users?${params}`, { signal });
    const data = await response.json();

    // Store pagination metadata
    paginationMeta = {
      total: data.metadata.total,
      hasMore: data.metadata.hasMore,
    };
    notifyMetaListeners();

    return data.items;
  },

  onSync: createSyncClient<User>({
    create: async (data, signal) => {
      return fetchToSyncResult({
        fetch: fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          signal,
        }),
        parseResponse: async (response) => {
          const result = await response.json();
          return { newId: result.id };
        },
        parseError: "Failed to create user",
      });
    },

    update: async (id, data, signal) => {
      return fetchToSyncResult({
        fetch: fetch(`/api/users/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          signal,
        }),
        parseError: "Failed to update user",
      });
    },

    delete: async (id, _data, signal) => {
      return fetchToSyncResult({
        fetch: fetch(`/api/users/${id}`, {
          method: "DELETE",
          signal,
        }),
        parseError: "Failed to delete user",
      });
    },
  }).onSync,
};

export const PaginatedUsers = React.memo(function PaginatedUsers() {
  const { items, context, loading, create, update, remove, setContext, getItemStatus } = useCrud<
    User,
    UserContext
  >(UsersConfig);

  const [meta, setMeta] = useState<PaginationMeta>({ total: 0, hasMore: false });

  // Subscribe to pagination metadata updates
  useEffect(() => {
    const listener = () => setMeta({ ...paginationMeta });
    metaListeners.add(listener);
    // Initialize with current value
    setMeta({ ...paginationMeta });
    return () => {
      metaListeners.delete(listener);
    };
  }, []);

  const users = Array.from(items.values());

  const nextPage = useCallback(() => {
    setContext((draft) => {
      draft.page += 1;
    });
  }, [setContext]);

  const prevPage = useCallback(() => {
    setContext((draft) => {
      if (draft.page > 1) {
        draft.page -= 1;
      }
    });
  }, [setContext]);

  const changeLimit = useCallback(
    (limit: number) => {
      setContext((draft) => {
        draft.limit = limit;
        draft.page = 1;
      });
    },
    [setContext],
  );

  const handleCreateUser = useCallback(() => {
    const name = prompt("Enter user name:");
    const email = prompt("Enter user email:");

    if (name && email) {
      create({
        id: `temp-${Date.now()}`,
        name,
        email,
        role: "user",
      });
    }
  }, [create]);

  const handleUpdateUser = useCallback(
    (user: User) => {
      const newName = prompt("Enter new name:", user.name);
      if (newName && newName !== user.name) {
        update(user.id, (draft) => {
          draft.name = newName;
        });
      }
    },
    [update],
  );

  const handleDeleteUser = useCallback(
    (user: User) => {
      if (confirm(`Delete user ${user.name}?`)) {
        remove(user.id);
      }
    },
    [remove],
  );

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Paginated Users</h1>

      {/* Pagination controls */}
      <div className="mb-4 flex justify-between items-center bg-gray-100 p-3 rounded">
        <div className="flex gap-2 items-center">
          <span className="text-sm font-semibold">Items per page:</span>
          <select
            value={context.limit}
            onChange={(e) => changeLimit(Number(e.target.value))}
            className="border px-2 py-1 rounded"
          >
            <option value="2">2</option>
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
          <span className="text-sm text-gray-600">({meta.total} total)</span>
        </div>

        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={prevPage}
            disabled={context.page === 1 || loading}
            className="bg-blue-500 text-white px-3 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600"
          >
            Previous
          </button>
          <span className="text-sm font-semibold">Page {context.page}</span>
          <button
            type="button"
            onClick={nextPage}
            disabled={!meta.hasMore || loading}
            className="bg-blue-500 text-white px-3 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600"
          >
            Next
          </button>
        </div>

        <button
          type="button"
          onClick={handleCreateUser}
          className="bg-green-500 text-white px-4 py-1 rounded hover:bg-green-600"
        >
          Add User
        </button>
      </div>

      {/* Users list */}
      <div className="space-y-2">
        {loading && users.length === 0 ? (
          <div className="text-center py-8 text-gray-500">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No users found</div>
        ) : (
          users.map((user) => {
            const status = getItemStatus(user.id);
            return (
              <div
                key={user.id}
                className="p-4 border rounded bg-white hover:shadow-md transition-shadow"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-lg">{user.name}</h3>
                    <p className="text-gray-600 text-sm">{user.email}</p>
                    <p className="text-gray-500 text-xs">Role: {user.role}</p>
                    {status && (
                      <span
                        className={`text-xs px-2 py-1 rounded mt-1 inline-block ${
                          status.status === "syncing"
                            ? "bg-blue-100 text-blue-700"
                            : status.status === "error"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {status.status}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleUpdateUser(user)}
                      className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteUser(user)}
                      className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {loading && users.length > 0 && (
        <div className="text-center py-4 text-gray-500">Loading...</div>
      )}
    </div>
  );
});
