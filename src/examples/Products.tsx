import React, { useCallback, useState } from "react";
import { useCrud, type Config, type SyncResult } from "../useCrud";
import { useItem } from "../useItem";
import type { Item } from "../item";

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
}

interface ProductContext {
  page: number;
  limit: number;
  category?: string;
  search?: string;
}

const ProductsConfig: Config<Product, ProductContext> = {
  id: "products",
  initialContext: {
    page: 1,
    limit: 10,
  },
  getId: (item) => item.id,

  // Sync configuration
  syncDebounce: 500,
  syncRetries: 3,

  // Cache configuration
  cacheCapacity: 5,
  cacheTtl: 30000, // 30 seconds

  // Fetch products with pagination and filtering
  onFetch: async (context, signal) => {
    const params = new URLSearchParams({
      page: String(context.page),
      limit: String(context.limit),
    });

    if (context.category) {
      params.append("category", context.category);
    }

    if (context.search) {
      params.append("search", context.search);
    }

    const response = await fetch(`/api/products?${params}`, { signal });
    const data = await response.json();

    return data.items;
  },

  // Sync changes (batch operation)
  onSync: async (changes, signal) => {
    const results: SyncResult[] = [];

    for (const change of changes) {
      try {
        if (change.type === "create") {
          const response = await fetch("/api/products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(change.data),
            signal,
          });

          if (!response.ok) {
            throw new Error("Failed to create product");
          }

          const data = await response.json();
          // Return newId so the library can remap the temporary ID to the server-assigned ID
          results.push({ id: change.id, status: "success", newId: data.id });
        } else if (change.type === "update") {
          const response = await fetch(`/api/products/${change.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(change.data),
            signal,
          });

          if (!response.ok) {
            throw new Error("Failed to update product");
          }

          results.push({ id: change.id, status: "success" });
        } else if (change.type === "delete") {
          const response = await fetch(`/api/products/${change.id}`, {
            method: "DELETE",
            signal,
          });

          if (!response.ok) {
            throw new Error("Failed to delete product");
          }

          results.push({ id: change.id, status: "success" });
        }
      } catch (error) {
        results.push({
          id: change.id,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  },
};

const ProductItem = React.memo(function ProductItem({
  item,
}: {
  item: Item<Product, ProductContext>;
}) {
  const { data: product, status, update, remove } = useItem(item);
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(product?.name ?? "");
  const [editedPrice, setEditedPrice] = useState(product?.price ?? 0);
  const [editedStock, setEditedStock] = useState(product?.stock ?? 0);

  const handleUpdate = useCallback(() => {
    update((draft) => {
      draft.name = editedName;
      draft.price = editedPrice;
      draft.stock = editedStock;
    });
    setIsEditing(false);
  }, [update, editedName, editedPrice, editedStock]);

  const handleDelete = useCallback(() => {
    if (product && confirm(`Delete ${product.name}?`)) {
      remove();
    }
  }, [remove, product]);

  if (!product) return null;

  if (isEditing) {
    return (
      <div className="p-3 border rounded bg-white mb-2">
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            className="border px-2 py-1 rounded"
            placeholder="Product name"
          />
          <input
            type="number"
            value={editedPrice}
            onChange={(e) => setEditedPrice(Number(e.target.value))}
            className="border px-2 py-1 rounded"
            placeholder="Price"
          />
          <input
            type="number"
            value={editedStock}
            onChange={(e) => setEditedStock(Number(e.target.value))}
            className="border px-2 py-1 rounded"
            placeholder="Stock"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleUpdate}
              className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="bg-gray-300 px-3 py-1 rounded hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 border rounded bg-white mb-2 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <h3 className="font-bold text-lg">{product.name}</h3>
          <p className="text-gray-600">
            ${product.price} • Stock: {product.stock} • Category: {product.category}
          </p>
          {status && (
            <div className="mt-1">
              <span
                className={`text-xs px-2 py-1 rounded ${
                  status.status === "syncing"
                    ? "bg-blue-100 text-blue-700"
                    : status.status === "error"
                      ? "bg-red-100 text-red-700"
                      : status.status === "pending"
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-green-100 text-green-700"
                }`}
              >
                {status.status === "syncing" && "Syncing..."}
                {status.status === "pending" && "Pending sync"}
                {status.status === "error" && `Error: ${status.error || "Unknown"}`}
                {status.status === "success" && "Synced"}
              </span>
              {status.retries > 0 && (
                <span className="text-xs text-gray-500 ml-2">
                  (Retries: {status.retries})
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            disabled={status?.status === "syncing"}
            className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={status?.status === "syncing"}
            className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
});

export const Products = React.memo(function Products() {
  const {
    items,
    context,
    loading,
    syncing,
    syncQueue,
    create,
    setContext,
    refresh,
    pauseSync,
    resumeSync,
    retrySync,
    getItem,
  } = useCrud<Product, ProductContext>(ProductsConfig);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    price: 0,
    category: "electronics",
    stock: 0,
  });

  const handleCreate = useCallback(() => {
    if (!newProduct.name) {
      alert("Product name is required");
      return;
    }

    create({
      id: `temp-${Date.now()}`,
      ...newProduct,
    });

    setNewProduct({ name: "", price: 0, category: "electronics", stock: 0 });
    setShowCreateForm(false);
  }, [newProduct, create]);

  const handleCategoryFilter = useCallback(
    (category?: string) => {
      setContext((draft) => {
        draft.category = category;
        draft.page = 1;
      });
    },
    [setContext],
  );

  const handleSearch = useCallback(
    (search: string) => {
      setContext((draft) => {
        draft.search = search || undefined;
        draft.page = 1;
      });
    },
    [setContext],
  );

  const productList = Array.from(items.values());
  const hasErrors = syncQueue.errors.size > 0;
  const hasPendingChanges = syncQueue.queue.size > 0 || syncQueue.inFlight.size > 0;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-4">Products Management (Full CRUD)</h1>

        {/* Status bar */}
        <div className="bg-gray-100 p-3 rounded mb-4">
          <div className="flex justify-between items-center">
            <div className="flex gap-4">
              <span className="text-sm">
                {loading ? "Loading..." : `${productList.length} products`}
              </span>
              {syncing && <span className="text-sm text-blue-600">Syncing changes...</span>}
              {hasPendingChanges && !syncing && (
                <span className="text-sm text-yellow-600">
                  {syncQueue.queue.size} pending
                </span>
              )}
              {hasErrors && (
                <span className="text-sm text-red-600">
                  {syncQueue.errors.size} errors
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={refresh}
                className="text-sm bg-gray-300 px-3 py-1 rounded hover:bg-gray-400"
              >
                Refresh
              </button>
              {syncQueue.isPaused ? (
                <button
                  type="button"
                  onClick={resumeSync}
                  className="text-sm bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                >
                  Resume Sync
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pauseSync}
                  className="text-sm bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600"
                >
                  Pause Sync
                </button>
              )}
              {hasErrors && (
                <button
                  type="button"
                  onClick={() => retrySync()}
                  className="text-sm bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
                >
                  Retry All
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleCategoryFilter(undefined)}
              className={`px-3 py-1 rounded ${!context.category ? "bg-blue-500 text-white" : "bg-gray-200"}`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => handleCategoryFilter("electronics")}
              className={`px-3 py-1 rounded ${context.category === "electronics" ? "bg-blue-500 text-white" : "bg-gray-200"}`}
            >
              Electronics
            </button>
            <button
              type="button"
              onClick={() => handleCategoryFilter("furniture")}
              className={`px-3 py-1 rounded ${context.category === "furniture" ? "bg-blue-500 text-white" : "bg-gray-200"}`}
            >
              Furniture
            </button>
            <button
              type="button"
              onClick={() => handleCategoryFilter("kitchen")}
              className={`px-3 py-1 rounded ${context.category === "kitchen" ? "bg-blue-500 text-white" : "bg-gray-200"}`}
            >
              Kitchen
            </button>
          </div>
          <input
            type="text"
            placeholder="Search products..."
            value={context.search || ""}
            onChange={(e) => handleSearch(e.target.value)}
            className="flex-1 border px-3 py-1 rounded"
          />
        </div>

        {/* Create button */}
        <button
          type="button"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 mb-4"
        >
          {showCreateForm ? "Cancel" : "Create Product"}
        </button>

        {/* Create form */}
        {showCreateForm && (
          <div className="p-4 border rounded bg-gray-50 mb-4">
            <h3 className="font-bold mb-3">New Product</h3>
            <div className="flex flex-col gap-2">
              <input
                type="text"
                placeholder="Product name"
                value={newProduct.name}
                onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                className="border px-3 py-2 rounded"
              />
              <input
                type="number"
                placeholder="Price"
                value={newProduct.price}
                onChange={(e) => setNewProduct({ ...newProduct, price: Number(e.target.value) })}
                className="border px-3 py-2 rounded"
              />
              <select
                value={newProduct.category}
                onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                className="border px-3 py-2 rounded"
              >
                <option value="electronics">Electronics</option>
                <option value="furniture">Furniture</option>
                <option value="kitchen">Kitchen</option>
                <option value="stationery">Stationery</option>
              </select>
              <input
                type="number"
                placeholder="Stock"
                value={newProduct.stock}
                onChange={(e) => setNewProduct({ ...newProduct, stock: Number(e.target.value) })}
                className="border px-3 py-2 rounded"
              />
              <button
                type="button"
                onClick={handleCreate}
                className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
              >
                Create
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Products list */}
      <div>
        {loading && productList.length === 0 ? (
          <div className="text-center py-8 text-gray-500">Loading products...</div>
        ) : productList.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No products found</div>
        ) : (
          <div>
            {productList.map((product) => (
              <ProductItem key={product.id} item={getItem(product.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
