import { vi, describe, it, expect, beforeEach } from "vitest";
import { FetchCache } from "../FetchCache";

describe("FetchCache", () => {
  let cache: FetchCache;
  const testData = { id: 1, name: "test" };

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new FetchCache(1000, 2); // 1 second age, 2 items capacity
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      const defaultCache = new FetchCache();
      expect(defaultCache.age).toBe(0);
      expect(defaultCache.capacity).toBe(0);
      expect(defaultCache.storage.size).toBe(0);
    });

    it("should initialize with provided values", () => {
      expect(cache.age).toBe(1000);
      expect(cache.capacity).toBe(2);
      expect(cache.storage.size).toBe(0);
    });
  });

  describe("put", () => {
    it("should not store items when capacity is 0", () => {
      const zeroCache = new FetchCache(1000, 0);
      zeroCache.put("test", testData);
      expect(zeroCache.storage.size).toBe(0);
    });

    it("should store items up to capacity", () => {
      cache.put("test1", testData);
      cache.put("test2", { id: 2, name: "test2" });
      expect(cache.storage.size).toBe(2);
    });

    it("should remove oldest item when capacity is exceeded", () => {
      cache.put("test1", testData);
      cache.put("test2", { id: 2, name: "test2" });
      cache.put("test3", { id: 3, name: "test3" });
      expect(cache.storage.size).toBe(2);
      expect(cache.storage.has("test1")).toBe(false);
      expect(cache.storage.has("test2")).toBe(true);
      expect(cache.storage.has("test3")).toBe(true);
    });
  });

  describe("get", () => {
    it("should return undefined when capacity is 0", () => {
      const zeroCache = new FetchCache(1000, 0);
      zeroCache.put("test", testData);
      expect(zeroCache.get("test")).toBeUndefined();
    });

    it("should return undefined for non-existent items", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("should return item if within age limit", () => {
      cache.put("test", testData);
      expect(cache.get("test")).toEqual(testData);
    });

    it("should remove and return undefined for expired items", () => {
      cache.put("test", testData);
      vi.advanceTimersByTime(1001); // Advance past the age limit
      expect(cache.get("test")).toBeUndefined();
      expect(cache.storage.has("test")).toBe(false);
    });
  });

  describe("remove", () => {
    it("should remove specified item", () => {
      cache.put("test", testData);
      expect(cache.storage.has("test")).toBe(true);
      cache.remove("test");
      expect(cache.storage.has("test")).toBe(false);
    });

    it("should do nothing when removing non-existent item", () => {
      cache.remove("nonexistent");
      expect(cache.storage.size).toBe(0);
    });
  });

  describe("invalidate", () => {
    it("should clear all items", () => {
      cache.put("test1", testData);
      cache.put("test2", { id: 2, name: "test2" });
      expect(cache.storage.size).toBe(2);
      cache.invalidate();
      expect(cache.storage.size).toBe(0);
    });
  });

  describe("reset", () => {
    it("should clear items and update age and capacity", () => {
      cache.put("test", testData);
      cache.reset(2000, 3);
      expect(cache.storage.size).toBe(0);
      expect(cache.age).toBe(2000);
      expect(cache.capacity).toBe(3);
    });
  });

  describe("withCache", () => {
    it("should return cached value if available and not expired", async () => {
      const callback = vi.fn().mockResolvedValue(testData);
      cache.put("test", testData);

      const result = await cache.withCache("test", callback);
      expect(result).toEqual(testData);
      expect(callback).not.toHaveBeenCalled();
    });

    it("should call callback and cache result if no cached value", async () => {
      const callback = vi.fn().mockResolvedValue(testData);

      const result = await cache.withCache("test", callback);
      expect(result).toEqual(testData);
      expect(callback).toHaveBeenCalled();
      expect(cache.get("test")).toEqual(testData);
    });

    it("should call callback and cache result if cached value is expired", async () => {
      const callback = vi.fn().mockResolvedValue(testData);
      cache.put("test", testData);
      vi.advanceTimersByTime(1001); // Expire the cache

      const result = await cache.withCache("test", callback);
      expect(result).toEqual(testData);
      expect(callback).toHaveBeenCalled();
      expect(cache.get("test")).toEqual(testData);
    });
  });
});
