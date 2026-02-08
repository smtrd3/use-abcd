import { http, delay } from "msw";
import { filter, find, findIndex, slice, size, toLower, includes, forEach } from "lodash-es";
import { createSyncServer, serverSyncSuccess, serverSyncError } from "../runtime/server";

// Types
type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
};

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type Comment = {
  id: string;
  postId: string;
  text: string;
  author: string;
  createdAt: string;
};

type ProductQuery = {
  page?: number;
  limit?: number;
  category?: string;
  search?: string;
};

type UserQuery = {
  page?: number;
  limit?: number;
};

type CommentQuery = {
  postId?: string;
};

type FileData = {
  name: string;
  content?: string;
};

type TreeNodeData = {
  id: string;
  position: number;
  value: FileData;
  type: string;
};

// Mock data stores
const products: Product[] = [
  { id: "1", name: "Laptop", price: 999, category: "electronics", stock: 15 },
  { id: "2", name: "Headphones", price: 199, category: "electronics", stock: 30 },
  { id: "3", name: "Coffee Mug", price: 12, category: "kitchen", stock: 100 },
  { id: "4", name: "Desk Chair", price: 299, category: "furniture", stock: 8 },
  { id: "5", name: "Notebook", price: 5, category: "stationery", stock: 200 },
];

const users: User[] = [
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

const comments: Comment[] = [
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

// Initial tree data simulating a file system
const treeNodes: TreeNodeData[] = [
  { id: "root", position: 0, value: { name: "Project" }, type: "object" },
  { id: "root.src", position: 0, value: { name: "src" }, type: "object" },
  {
    id: "root.src.index",
    position: 0,
    value: { name: "index.ts", content: 'console.log("Hello World");' },
    type: "primitive",
  },
  {
    id: "root.src.utils",
    position: 1,
    value: {
      name: "utils.ts",
      content: "export function add(a: number, b: number) {\n  return a + b;\n}",
    },
    type: "primitive",
  },
  { id: "root.docs", position: 1, value: { name: "docs" }, type: "object" },
  {
    id: "root.docs.readme",
    position: 0,
    value: { name: "README.md", content: "# My Project\n\nThis is a demo project." },
    type: "primitive",
  },
  {
    id: "root.package",
    position: 2,
    value: { name: "package.json", content: '{\n  "name": "my-project",\n  "version": "1.0.0"\n}' },
    type: "primitive",
  },
];

// Simulate network delay
const NETWORK_DELAY = 800;

// Products sync server
const productsServer = createSyncServer<Product, ProductQuery>({
  fetch: (query) => {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const category = query.category;
    const search = query.search;

    let filtered = [...products];

    if (category) {
      filtered = filter(filtered, (p) => p.category === category);
    }

    if (search) {
      filtered = filter(filtered, (p) => includes(toLower(p.name), toLower(search)));
    }

    const start = (page - 1) * limit;
    const end = start + limit;

    return slice(filtered, start, end);
  },
  create: (data) => {
    const newProduct: Product = {
      id: String(Date.now()),
      name: data.name || "",
      price: data.price || 0,
      category: data.category || "other",
      stock: data.stock || 0,
    };
    products.push(newProduct);
    return serverSyncSuccess({ newId: newProduct.id });
  },
  update: (id, data) => {
    const index = findIndex(products, (p) => p.id === id);
    if (index === -1) {
      return serverSyncError("Product not found");
    }
    products[index] = { ...products[index], ...data };
    return serverSyncSuccess();
  },
  delete: (id) => {
    const index = findIndex(products, (p) => p.id === id);
    if (index === -1) {
      return serverSyncError("Product not found");
    }
    products.splice(index, 1);
    return serverSyncSuccess();
  },
});

// Users sync server
const usersServer = createSyncServer<User, UserQuery>({
  fetch: (query) => {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const start = (page - 1) * limit;
    const end = start + limit;

    return slice(users, start, end);
  },
  create: (data) => {
    const newUser: User = {
      id: String(Date.now()),
      name: data.name || "",
      email: data.email || "",
      role: data.role || "user",
    };
    users.push(newUser);
    return serverSyncSuccess({ newId: newUser.id });
  },
  update: (id, data) => {
    const index = findIndex(users, (u) => u.id === id);
    if (index === -1) {
      return serverSyncError("User not found");
    }
    users[index] = { ...users[index], ...data };
    return serverSyncSuccess();
  },
  delete: (id) => {
    const index = findIndex(users, (u) => u.id === id);
    if (index === -1) {
      return serverSyncError("User not found");
    }
    users.splice(index, 1);
    return serverSyncSuccess();
  },
});

// Tree sync server
const treeServer = createSyncServer<TreeNodeData>({
  fetch: () => [...treeNodes],
  create: (data) => {
    const newNode: TreeNodeData = {
      id: data.id,
      position: data.position ?? 0,
      value: data.value ?? { name: "" },
      type: data.type ?? "primitive",
    };
    treeNodes.push(newNode);
    return serverSyncSuccess({ newId: newNode.id });
  },
  update: (id, data) => {
    const index = findIndex(treeNodes, (n) => n.id === id);
    if (index === -1) {
      return serverSyncError("Node not found");
    }
    treeNodes[index] = { ...treeNodes[index], ...data };
    return serverSyncSuccess();
  },
  delete: (id) => {
    // Delete node and all descendants
    const toDelete = filter(treeNodes, (n) => n.id === id || n.id.startsWith(id + "."));
    forEach(toDelete, (node) => {
      const index = findIndex(treeNodes, (n) => n.id === node.id);
      if (index !== -1) {
        treeNodes.splice(index, 1);
      }
    });
    return serverSyncSuccess();
  },
});

// Comments sync server
const commentsServer = createSyncServer<Comment, CommentQuery>({
  fetch: (query) => {
    if (query.postId) {
      return filter(comments, (c) => c.postId === query.postId);
    }
    return [...comments];
  },
  create: (data) => {
    const newComment: Comment = {
      id: String(Date.now()),
      postId: data.postId || "1",
      text: data.text || "",
      author: data.author || "Anonymous",
      createdAt: new Date().toISOString(),
    };
    comments.push(newComment);
    return serverSyncSuccess({ newId: newComment.id });
  },
  update: (id, data) => {
    const index = findIndex(comments, (c) => c.id === id);
    if (index === -1) {
      return serverSyncError("Comment not found");
    }
    comments[index] = { ...comments[index], ...data };
    return serverSyncSuccess();
  },
  delete: (id) => {
    const index = findIndex(comments, (c) => c.id === id);
    if (index === -1) {
      return serverSyncError("Comment not found");
    }
    comments.splice(index, 1);
    return serverSyncSuccess();
  },
});

// Handlers using createSyncServer
export const handlers = [
  // Products sync endpoint
  http.post("/api/products/sync", async ({ request }) => {
    await delay(NETWORK_DELAY);
    return productsServer.handler(request);
  }),

  // Users sync endpoint
  http.post("/api/users/sync", async ({ request }) => {
    await delay(NETWORK_DELAY);
    return usersServer.handler(request);
  }),

  // Comments sync endpoint
  http.post("/api/comments/sync", async ({ request }) => {
    await delay(NETWORK_DELAY);
    return commentsServer.handler(request);
  }),

  // Tree sync endpoint
  http.post("/api/tree/sync", async ({ request }) => {
    await delay(NETWORK_DELAY);
    return treeServer.handler(request);
  }),

  // Error simulation endpoint
  http.get("/api/error-test", async ({ request }) => {
    await delay(NETWORK_DELAY);

    const url = new URL(request.url);
    const errorType = url.searchParams.get("type");

    if (errorType === "network") {
      return new Response(null, { status: 0 });
    }

    if (errorType === "500") {
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (errorType === "timeout") {
      await delay(30000);
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
];

// Export data for tests
export const mockData = {
  products,
  users,
  comments,
  treeNodes,
  getProduct: (id: string) => find(products, (p) => p.id === id),
  getUser: (id: string) => find(users, (u) => u.id === id),
  getComment: (id: string) => find(comments, (c) => c.id === id),
  getTreeNode: (id: string) => find(treeNodes, (n) => n.id === id),
  getProductsCount: () => size(products),
  getUsersCount: () => size(users),
  getCommentsCount: () => size(comments),
  getTreeNodesCount: () => size(treeNodes),
};
