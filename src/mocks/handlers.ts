import { http, HttpResponse, delay } from "msw";

// Mock data stores
const products = [
  { id: "1", name: "Laptop", price: 999, category: "electronics", stock: 15 },
  { id: "2", name: "Headphones", price: 199, category: "electronics", stock: 30 },
  { id: "3", name: "Coffee Mug", price: 12, category: "kitchen", stock: 100 },
  { id: "4", name: "Desk Chair", price: 299, category: "furniture", stock: 8 },
  { id: "5", name: "Notebook", price: 5, category: "stationery", stock: 200 },
];

const users = [
  { id: "1", name: "John Doe", email: "john@example.com", role: "admin" },
  { id: "2", name: "Jane Smith", email: "jane@example.com", role: "user" },
  { id: "3", name: "Bob Johnson", email: "bob@example.com", role: "user" },
  { id: "4", name: "Alice Williams", email: "alice@example.com", role: "user" },
  { id: "5", name: "Charlie Brown", email: "charlie@example.com", role: "user" },
  { id: "6", name: "Diana Prince", email: "diana@example.com", role: "admin" },
  { id: "7", name: "Edward Norton", email: "edward@example.com", role: "user" },
  { id: "8", name: "Fiona Green", email: "fiona@example.com", role: "user" },
  { id: "9", name: "George Miller", email: "george@example.com", role: "user" },
  { id: "10", name: "Hannah Lee", email: "hannah@example.com", role: "user" },
  { id: "11", name: "Ivan Petrov", email: "ivan@example.com", role: "user" },
  { id: "12", name: "Julia Roberts", email: "julia@example.com", role: "admin" },
];

const comments = [
  {
    id: "1",
    postId: "1",
    text: "Great post!",
    author: "Alice",
    createdAt: new Date().toISOString(),
  },
  {
    id: "2",
    postId: "1",
    text: "Thanks for sharing",
    author: "Bob",
    createdAt: new Date().toISOString(),
  },
];

// Simulate network delay
const NETWORK_DELAY = 800;

export const handlers = [
  // Products - List with pagination and filtering
  http.get("/api/products", async ({ request }) => {
    await delay(NETWORK_DELAY);

    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get("page") || "1");
    const limit = Number.parseInt(url.searchParams.get("limit") || "10");
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("search");

    let filtered = [...products];

    if (category) {
      filtered = filtered.filter((p) => p.category === category);
    }

    if (search) {
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    }

    const start = (page - 1) * limit;
    const end = start + limit;
    const paginated = filtered.slice(start, end);

    return HttpResponse.json({
      items: paginated,
      metadata: {
        total: filtered.length,
        page,
        limit,
        hasMore: end < filtered.length,
      },
    });
  }),

  // Products - Create
  http.post("/api/products", async ({ request }) => {
    await delay(NETWORK_DELAY);

    const body = (await request.json()) as Partial<(typeof products)[0]>;
    const newProduct = {
      id: String(Date.now()),
      name: body.name || "",
      price: body.price || 0,
      category: body.category || "other",
      stock: body.stock || 0,
    };

    products.push(newProduct);

    return HttpResponse.json({ id: newProduct.id }, { status: 201 });
  }),

  // Products - Update
  http.patch("/api/products/:id", async ({ params, request }) => {
    await delay(NETWORK_DELAY);

    const { id } = params;
    const body = (await request.json()) as Partial<(typeof products)[0]>;

    const index = products.findIndex((p) => p.id === id);
    if (index === -1) {
      return HttpResponse.json({ error: "Product not found" }, { status: 404 });
    }

    products[index] = { ...products[index], ...body };

    return HttpResponse.json({ id });
  }),

  // Products - Delete
  http.delete("/api/products/:id", async ({ params }) => {
    await delay(NETWORK_DELAY);

    const { id } = params;
    const index = products.findIndex((p) => p.id === id);

    if (index === -1) {
      return HttpResponse.json({ error: "Product not found" }, { status: 404 });
    }

    products.splice(index, 1);

    return HttpResponse.json({ id });
  }),

  // Users - List with pagination
  http.get("/api/users", async ({ request }) => {
    await delay(NETWORK_DELAY);

    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get("page") || "1");
    const limit = Number.parseInt(url.searchParams.get("limit") || "10");

    const start = (page - 1) * limit;
    const end = start + limit;
    const paginated = users.slice(start, end);

    return HttpResponse.json({
      items: paginated,
      metadata: {
        total: users.length,
        page,
        limit,
        hasMore: end < users.length,
      },
    });
  }),

  // Users - Create
  http.post("/api/users", async ({ request }) => {
    await delay(NETWORK_DELAY);

    const body = (await request.json()) as Partial<(typeof users)[0]>;
    const newUser = {
      id: String(Date.now()),
      name: body.name || "",
      email: body.email || "",
      role: body.role || "user",
    };

    users.push(newUser);

    return HttpResponse.json({ id: newUser.id }, { status: 201 });
  }),

  // Users - Update
  http.patch("/api/users/:id", async ({ params, request }) => {
    await delay(NETWORK_DELAY);

    const { id } = params;
    const body = (await request.json()) as Partial<(typeof users)[0]>;

    const index = users.findIndex((u) => u.id === id);
    if (index === -1) {
      return HttpResponse.json({ error: "User not found" }, { status: 404 });
    }

    users[index] = { ...users[index], ...body };

    return HttpResponse.json({ id });
  }),

  // Users - Delete
  http.delete("/api/users/:id", async ({ params }) => {
    await delay(NETWORK_DELAY);

    const { id } = params;
    const index = users.findIndex((u) => u.id === id);

    if (index === -1) {
      return HttpResponse.json({ error: "User not found" }, { status: 404 });
    }

    users.splice(index, 1);

    return HttpResponse.json({ id });
  }),

  // Comments - List
  http.get("/api/comments", async ({ request }) => {
    await delay(NETWORK_DELAY);

    const url = new URL(request.url);
    const postId = url.searchParams.get("postId");

    let filtered = [...comments];

    if (postId) {
      filtered = filtered.filter((c) => c.postId === postId);
    }

    return HttpResponse.json({
      items: filtered,
      metadata: { total: filtered.length },
    });
  }),

  // Comments - Create
  http.post("/api/comments", async ({ request }) => {
    await delay(NETWORK_DELAY);

    const body = (await request.json()) as Partial<(typeof comments)[0]>;
    const newComment = {
      id: String(Date.now()),
      postId: body.postId || "1",
      text: body.text || "",
      author: body.author || "Anonymous",
      createdAt: new Date().toISOString(),
    };

    comments.push(newComment);

    return HttpResponse.json({ id: newComment.id }, { status: 201 });
  }),

  // Comments - Update
  http.patch("/api/comments/:id", async ({ params, request }) => {
    await delay(NETWORK_DELAY);

    const { id } = params;
    const body = (await request.json()) as Partial<(typeof comments)[0]>;

    const index = comments.findIndex((c) => c.id === id);
    if (index === -1) {
      return HttpResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    comments[index] = { ...comments[index], ...body };

    return HttpResponse.json({ id });
  }),

  // Comments - Delete
  http.delete("/api/comments/:id", async ({ params }) => {
    await delay(NETWORK_DELAY);

    const { id } = params;
    const index = comments.findIndex((c) => c.id === id);

    if (index === -1) {
      return HttpResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    comments.splice(index, 1);

    return HttpResponse.json({ id });
  }),

  // Error simulation endpoint
  http.get("/api/error-test", async ({ request }) => {
    await delay(NETWORK_DELAY);

    const url = new URL(request.url);
    const errorType = url.searchParams.get("type");

    if (errorType === "network") {
      return HttpResponse.error();
    }

    if (errorType === "500") {
      return HttpResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (errorType === "timeout") {
      await delay(30000);
      return HttpResponse.json({ items: [] });
    }

    return HttpResponse.json({ items: [] });
  }),
];

// Export batch sync handler for handling multiple operations
export const batchHandlers = [
  http.post("/api/sync", async ({ request }) => {
    await delay(NETWORK_DELAY);

    const changes = await request.json();

    if (!Array.isArray(changes)) {
      return HttpResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const results = changes.map((change: { id: string }) => {
      try {
        // Simulate processing each change
        return {
          id: change.id,
          status: "success" as const,
        };
      } catch {
        return {
          id: change.id,
          status: "error" as const,
          error: "Failed to sync",
        };
      }
    });

    return HttpResponse.json(results);
  }),
];
