type CachedItem = { data: unknown; ts: number };
/**
 * Cache implementation for storing and managing fetch results
 * with configurable age and capacity limits.
 */
export class FetchCache {
  age: number = 0;
  capacity: number = 0;
  storage: Map<string, CachedItem> = new Map();

  constructor(age: number = 0, capacity: number = 0) {
    this.age = age;
    this.capacity = capacity;
  }

  invalidate() {
    this.storage.clear();
  }

  reset(age: number, capacity: number) {
    this.invalidate();
    this.age = age;
    this.capacity = capacity;
  }

  get(id: string) {
    if (this.capacity === 0) return;
    const cachedItem = this.storage.get(id);
    if (cachedItem) {
      const age = Date.now() - cachedItem.ts;
      if (age > this.age) {
        this.storage.delete(id);
        return;
      } else {
        return cachedItem.data;
      }
    }
    return;
  }

  put(id: string, item: unknown) {
    if (this.capacity > 0) {
      this.storage.set(id, { data: item, ts: Date.now() });
    }
    if (this.storage.size > this.capacity) {
      const delKey = [...this.storage.keys()].at(0);
      this.storage.delete(delKey);
    }
  }

  remove(id: string) {
    this.storage.delete(id);
  }

  withCache = async (id: string, callback: () => Promise<unknown>) => {
    const cachedItem = this.get(id);
    if (cachedItem) {
      return cachedItem;
    }

    return callback().then((response) => {
      this.put(id, response);
      return response;
    });
  };
}
