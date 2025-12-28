type CacheEntry<T> = { data: T; ts: number };

export class Cache<T> {
  private _cache = new Map<string, CacheEntry<T>>();
  private _capacity: number;
  private _ttl: number;

  constructor(capacity: number, ttl: number) {
    this._capacity = capacity;
    this._ttl = ttl;
  }

  get(key: string): T | null {
    const entry = this._cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.ts > this._ttl) {
      this._cache.delete(key);
      return null;
    }

    // Move to end (most recently used) for LRU
    this._cache.delete(key);
    this._cache.set(key, entry);
    return entry.data;
  }

  set(key: string, value: T): void {
    if (this._cache.has(key)) {
      this._cache.delete(key);
    } else if (this._cache.size >= this._capacity) {
      const firstKey = this._cache.keys().next().value;
      if (firstKey !== undefined) this._cache.delete(firstKey);
    }

    this._cache.set(key, { data: value, ts: Date.now() });
  }

  invalidate(key: string): void {
    this._cache.delete(key);
  }

  clear(): void {
    this._cache.clear();
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  get size(): number {
    return this._cache.size;
  }
}
