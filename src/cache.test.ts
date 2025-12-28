import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Cache } from "./cache";

describe("Cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Basic Operations", () => {
    it("should store and retrieve values", () => {
      const cache = new Cache<string>(5, 10000);

      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
    });

    it("should return null for non-existent keys", () => {
      const cache = new Cache<string>(5, 10000);

      expect(cache.get("nonexistent")).toBeNull();
    });

    it("should overwrite existing values", () => {
      const cache = new Cache<string>(5, 10000);

      cache.set("key1", "value1");
      cache.set("key1", "value2");

      expect(cache.get("key1")).toBe("value2");
    });

    it("should handle different data types", () => {
      const objectCache = new Cache<{ id: number; name: string }>(5, 10000);
      const arrayCache = new Cache<number[]>(5, 10000);
      const numberCache = new Cache<number>(5, 10000);

      objectCache.set("obj", { id: 1, name: "test" });
      arrayCache.set("arr", [1, 2, 3]);
      numberCache.set("num", 42);

      expect(objectCache.get("obj")).toEqual({ id: 1, name: "test" });
      expect(arrayCache.get("arr")).toEqual([1, 2, 3]);
      expect(numberCache.get("num")).toBe(42);
    });

    it("should track size correctly", () => {
      const cache = new Cache<string>(5, 10000);

      expect(cache.size).toBe(0);

      cache.set("key1", "value1");
      expect(cache.size).toBe(1);

      cache.set("key2", "value2");
      expect(cache.size).toBe(2);

      cache.set("key1", "updated"); // Overwrite
      expect(cache.size).toBe(2);
    });
  });

  describe("TTL (Time-To-Live)", () => {
    it("should return value before TTL expires", () => {
      const cache = new Cache<string>(5, 1000);

      cache.set("key1", "value1");

      vi.advanceTimersByTime(500);
      expect(cache.get("key1")).toBe("value1");
    });

    it("should return null after TTL expires", () => {
      const cache = new Cache<string>(5, 1000);

      cache.set("key1", "value1");

      vi.advanceTimersByTime(1001);
      expect(cache.get("key1")).toBeNull();
    });

    it("should remove expired entry from cache on access", () => {
      const cache = new Cache<string>(5, 1000);

      cache.set("key1", "value1");
      expect(cache.size).toBe(1);

      vi.advanceTimersByTime(1001);
      cache.get("key1"); // Access expired entry

      expect(cache.size).toBe(0);
    });

    it("should handle TTL at exact boundary", () => {
      const cache = new Cache<string>(5, 1000);

      cache.set("key1", "value1");

      vi.advanceTimersByTime(1000);
      expect(cache.get("key1")).toBe("value1"); // Exactly at TTL should still be valid

      vi.advanceTimersByTime(1);
      expect(cache.get("key1")).toBeNull(); // Just past TTL should be invalid
    });

    it("should refresh TTL on update", () => {
      const cache = new Cache<string>(5, 1000);

      cache.set("key1", "value1");
      vi.advanceTimersByTime(800);

      cache.set("key1", "value2"); // Update resets TTL
      vi.advanceTimersByTime(800);

      expect(cache.get("key1")).toBe("value2"); // Should still be valid
    });
  });

  describe("LRU Eviction", () => {
    it("should evict oldest entry when at capacity", () => {
      const cache = new Cache<string>(3, 10000);

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");
      cache.set("key4", "value4"); // Should evict key1

      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).toBe("value2");
      expect(cache.get("key3")).toBe("value3");
      expect(cache.get("key4")).toBe("value4");
      expect(cache.size).toBe(3);
    });

    it("should update LRU order on get", () => {
      const cache = new Cache<string>(3, 10000);

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      cache.get("key1"); // Access key1, making it most recently used

      cache.set("key4", "value4"); // Should evict key2 (now oldest)

      expect(cache.get("key1")).toBe("value1");
      expect(cache.get("key2")).toBeNull();
      expect(cache.get("key3")).toBe("value3");
      expect(cache.get("key4")).toBe("value4");
    });

    it("should update LRU order on set (update)", () => {
      const cache = new Cache<string>(3, 10000);

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      cache.set("key1", "updated"); // Update key1, making it most recently used

      cache.set("key4", "value4"); // Should evict key2 (now oldest)

      expect(cache.get("key1")).toBe("updated");
      expect(cache.get("key2")).toBeNull();
      expect(cache.get("key3")).toBe("value3");
      expect(cache.get("key4")).toBe("value4");
    });

    it("should handle capacity of 1", () => {
      const cache = new Cache<string>(1, 10000);

      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");

      cache.set("key2", "value2");
      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).toBe("value2");
      expect(cache.size).toBe(1);
    });

    it("should not evict when updating existing key at capacity", () => {
      const cache = new Cache<string>(3, 10000);

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      cache.set("key2", "updated"); // Update existing, no eviction

      expect(cache.get("key1")).toBe("value1");
      expect(cache.get("key2")).toBe("updated");
      expect(cache.get("key3")).toBe("value3");
      expect(cache.size).toBe(3);
    });
  });

  describe("invalidate", () => {
    it("should remove specific entry", () => {
      const cache = new Cache<string>(5, 10000);

      cache.set("key1", "value1");
      cache.set("key2", "value2");

      cache.invalidate("key1");

      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).toBe("value2");
      expect(cache.size).toBe(1);
    });

    it("should handle invalidating non-existent key", () => {
      const cache = new Cache<string>(5, 10000);

      cache.set("key1", "value1");

      cache.invalidate("nonexistent"); // Should not throw

      expect(cache.get("key1")).toBe("value1");
      expect(cache.size).toBe(1);
    });
  });

  describe("clear", () => {
    it("should remove all entries", () => {
      const cache = new Cache<string>(5, 10000);

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      cache.clear();

      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).toBeNull();
      expect(cache.get("key3")).toBeNull();
      expect(cache.size).toBe(0);
    });

    it("should handle clearing empty cache", () => {
      const cache = new Cache<string>(5, 10000);

      cache.clear(); // Should not throw

      expect(cache.size).toBe(0);
    });
  });

  describe("has", () => {
    it("should return true for existing valid entry", () => {
      const cache = new Cache<string>(5, 10000);

      cache.set("key1", "value1");

      expect(cache.has("key1")).toBe(true);
    });

    it("should return false for non-existent entry", () => {
      const cache = new Cache<string>(5, 10000);

      expect(cache.has("nonexistent")).toBe(false);
    });

    it("should return false for expired entry", () => {
      const cache = new Cache<string>(5, 1000);

      cache.set("key1", "value1");

      vi.advanceTimersByTime(1001);

      expect(cache.has("key1")).toBe(false);
    });

    it("should update LRU order when checking", () => {
      const cache = new Cache<string>(3, 10000);

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      cache.has("key1"); // Updates LRU order via get()

      cache.set("key4", "value4"); // Should evict key2

      expect(cache.has("key1")).toBe(true);
      expect(cache.has("key2")).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string key", () => {
      const cache = new Cache<string>(5, 10000);

      cache.set("", "empty key value");

      expect(cache.get("")).toBe("empty key value");
    });

    it("should handle null and undefined values (limitation)", () => {
      const cache = new Cache<string | null | undefined>(5, 10000);

      cache.set("null", null);
      cache.set("undefined", undefined);

      // Known limitation: get() returns null for missing keys, so:
      // - null values are indistinguishable from missing keys
      // - has() returns false for null values since it uses get() !== null
      // - undefined values work because get() returns the actual undefined
      expect(cache.has("null")).toBe(false); // Limitation: null value appears missing
      expect(cache.get("undefined")).toBe(undefined);
      expect(cache.size).toBe(2); // Both entries are stored
    });

    it("should handle rapid sequential operations", () => {
      const cache = new Cache<number>(3, 10000);

      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, i);
      }

      // Only last 3 should remain
      expect(cache.size).toBe(3);
      expect(cache.get("key97")).toBe(97);
      expect(cache.get("key98")).toBe(98);
      expect(cache.get("key99")).toBe(99);
    });

    it("should handle interleaved get and set operations", () => {
      const cache = new Cache<string>(3, 10000);

      cache.set("a", "1");
      cache.set("b", "2");
      cache.get("a");
      cache.set("c", "3");
      cache.get("b");
      cache.set("d", "4"); // Evicts 'a' or 'c' depending on LRU

      // 'c' was least recently used (set, but not accessed since)
      // Wait, let's trace: a(set), b(set), a(get), c(set), b(get), d(set)
      // After a(get): order is b, a
      // After c(set): order is b, a, c
      // After b(get): order is a, c, b
      // After d(set): evicts 'a', order is c, b, d
      expect(cache.get("a")).toBeNull();
      expect(cache.get("b")).toBe("2");
      expect(cache.get("c")).toBe("3");
      expect(cache.get("d")).toBe("4");
    });

    it("should handle very large capacity", () => {
      const cache = new Cache<number>(10000, 10000);

      for (let i = 0; i < 5000; i++) {
        cache.set(`key${i}`, i);
      }

      expect(cache.size).toBe(5000);
      expect(cache.get("key0")).toBe(0);
      expect(cache.get("key4999")).toBe(4999);
    });

    it("should handle very short TTL", () => {
      const cache = new Cache<string>(5, 1);

      cache.set("key1", "value1");

      vi.advanceTimersByTime(2);

      expect(cache.get("key1")).toBeNull();
    });

    it("should handle zero TTL boundary correctly", () => {
      const cache = new Cache<string>(5, 0);

      cache.set("key1", "value1");

      // With TTL of 0, entry should still be valid at same timestamp
      expect(cache.get("key1")).toBe("value1");

      vi.advanceTimersByTime(1);
      expect(cache.get("key1")).toBeNull();
    });
  });

  describe("Combined TTL and LRU", () => {
    it("should evict by LRU before checking TTL", () => {
      const cache = new Cache<string>(2, 10000);

      cache.set("key1", "value1");
      vi.advanceTimersByTime(100);
      cache.set("key2", "value2");
      vi.advanceTimersByTime(100);

      cache.get("key1"); // Access key1, making key2 oldest

      cache.set("key3", "value3"); // Should evict key2 (LRU), not key1 (oldest by time)

      expect(cache.get("key1")).toBe("value1");
      expect(cache.get("key2")).toBeNull();
      expect(cache.get("key3")).toBe("value3");
    });

    it("should handle mixed expired and valid entries during eviction", () => {
      const cache = new Cache<string>(3, 500);

      cache.set("key1", "value1");
      vi.advanceTimersByTime(300);

      cache.set("key2", "value2");
      vi.advanceTimersByTime(300);

      // key1 is now expired (600ms > 500ms TTL)
      // key2 is still valid (300ms < 500ms TTL)

      cache.set("key3", "value3");

      // key1 expired but wasn't checked, so LRU eviction happened
      // Actually, set() doesn't check TTL, so key1 is still in cache
      // But get() will return null for expired key1
      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).toBe("value2");
      expect(cache.get("key3")).toBe("value3");
    });
  });
});
