import { http, delay } from "msw";
import { filter, findIndex } from "lodash-es";
import { createCrudHandler, createSyncServer } from "../runtime/server";

// --- Address generation for benchmark ---

const STREETS = [
  "Main St",
  "Oak Ave",
  "Elm Dr",
  "Cedar Ln",
  "Pine Rd",
  "Maple Ct",
  "Birch Way",
  "Walnut Blvd",
  "Spruce Pl",
  "Willow Ter",
  "Ash St",
  "Cherry Ln",
  "Poplar Ave",
  "Hickory Dr",
  "Sycamore Rd",
  "Chestnut Ct",
  "Magnolia Way",
  "Dogwood Blvd",
  "Juniper Pl",
  "Cypress Ter",
];
const CITIES = [
  "Springfield",
  "Riverside",
  "Fairview",
  "Madison",
  "Georgetown",
  "Clinton",
  "Arlington",
  "Salem",
  "Franklin",
  "Chester",
  "Burlington",
  "Oakland",
  "Greenville",
  "Bristol",
  "Newport",
];
const STATES = [
  "CA",
  "TX",
  "NY",
  "FL",
  "IL",
  "PA",
  "OH",
  "GA",
  "NC",
  "MI",
  "NJ",
  "VA",
  "WA",
  "AZ",
  "MA",
  "TN",
  "IN",
  "MO",
  "MD",
  "WI",
];

function generateAddresses(count: number): Address[] {
  const result: Address[] = [];
  for (let i = 0; i < count; i++) {
    const id = String(i + 1);
    result.push({
      id,
      name: `Person ${id}`,
      street: `${((i * 37 + 100) % 9900) + 100} ${STREETS[i % STREETS.length]}`,
      city: CITIES[i % CITIES.length],
      state: STATES[i % STATES.length],
      zip: String(10000 + ((i * 73) % 89999)),
    });
  }
  return result;
}

let addresses: Address[] = [];

// --- Data types ---

type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
};

type ProductQuery = {
  page: number;
  limit: number;
  category?: string;
  search?: string;
};

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type UserQuery = {
  page: number;
  limit: number;
};

type Comment = {
  id: string;
  postId: string;
  text: string;
  author: string;
  createdAt: string;
};

type CommentQuery = {
  postId: string;
};

type Address = {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
};

type AddressQuery = {
  count: number;
};

// --- In-memory stores ---

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

// --- CRUD handlers ---

const NETWORK_DELAY = 800;

const productsServer = createSyncServer(
  createCrudHandler<Product, ProductQuery>({
    fetch: async ({ query }) => {
      let filtered = [...products];

      if (query.category) {
        filtered = filter(filtered, (p) => p.category === query.category);
      }

      if (query.search) {
        filtered = filter(filtered, (p) =>
          p.name.toLowerCase().includes(query.search!.toLowerCase()),
        );
      }

      const start = (query.page - 1) * query.limit;
      return filtered.slice(start, start + query.limit);
    },
    create: async (record) => {
      products.push(record.data);
    },
    update: async (record) => {
      const idx = findIndex(products, (p) => p.id === record.data.id);
      if (idx !== -1) products[idx] = record.data;
    },
    remove: async (record) => {
      const idx = findIndex(products, (p) => p.id === record.data.id);
      if (idx !== -1) products.splice(idx, 1);
    },
  }),
);

const usersServer = createSyncServer(
  createCrudHandler<User, UserQuery, { total: number; hasMore: boolean }>({
    fetch: async ({ query }) => {
      const start = (query.page - 1) * query.limit;
      const end = start + query.limit;
      return {
        items: users.slice(start, end),
        serverState: { total: users.length, hasMore: end < users.length },
      };
    },
    create: async (record) => {
      users.push(record.data);
    },
    update: async (record) => {
      const idx = findIndex(users, (u) => u.id === record.data.id);
      if (idx !== -1) users[idx] = record.data;
    },
    remove: async (record) => {
      const idx = findIndex(users, (u) => u.id === record.data.id);
      if (idx !== -1) users.splice(idx, 1);
    },
  }),
);

const commentsServer = createSyncServer(
  createCrudHandler<Comment, CommentQuery>({
    fetch: async ({ query }) => {
      return filter(comments, (c) => c.postId === query.postId);
    },
    create: async (record) => {
      comments.push(record.data);
    },
    update: async (record) => {
      const idx = findIndex(comments, (c) => c.id === record.data.id);
      if (idx !== -1) comments[idx] = record.data;
    },
    remove: async (record) => {
      const idx = findIndex(comments, (c) => c.id === record.data.id);
      if (idx !== -1) comments.splice(idx, 1);
    },
  }),
);

const addressesServer = createSyncServer(
  createCrudHandler<Address, AddressQuery>({
    fetch: async ({ query }) => {
      if (addresses.length !== query.count) {
        addresses = generateAddresses(query.count);
      }
      return addresses;
    },
    create: async (record) => {
      addresses.push(record.data);
    },
    update: async (record) => {
      const idx = findIndex(addresses, (a) => a.id === record.data.id);
      if (idx !== -1) addresses[idx] = record.data;
    },
    remove: async (record) => {
      const idx = findIndex(addresses, (a) => a.id === record.data.id);
      if (idx !== -1) addresses.splice(idx, 1);
    },
  }),
);

// --- MSW handlers ---

export const handlers = [
  http.post("/api/products", async ({ request }) => {
    await delay(NETWORK_DELAY);
    return productsServer(request);
  }),

  http.post("/api/users", async ({ request }) => {
    await delay(NETWORK_DELAY);
    return usersServer(request);
  }),

  http.post("/api/comments", async ({ request }) => {
    await delay(NETWORK_DELAY);
    return commentsServer(request);
  }),

  http.post("/api/addresses", async ({ request }) => {
    await delay(NETWORK_DELAY);
    return addressesServer(request);
  }),
];
