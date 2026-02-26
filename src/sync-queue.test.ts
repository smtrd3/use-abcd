import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncQueue } from "./sync-queue";
import type { Change, Result } from "./types";

interface TestItem {
  id: string;
  value: string;
}

describe("SyncQueue", () => {
  let syncQueue: SyncQueue<TestItem>;
  let mockOnSync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockOnSync = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Basic Enqueueing", () => {
    it("should enqueue a change and schedule flush", async () => {
      mockOnSync.mockResolvedValue({ "1": { status: "success" } });
      syncQueue = new SyncQueue({
        debounce: 300,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      const change: Change<TestItem> = {
        id: "1",
        type: "create",
        data: { id: "1", value: "test" },
      };

      syncQueue.enqueue(change);

      const state = syncQueue.getState();
      expect(state.queue.size).toBe(1);
      expect(state.queue.get("1")).toEqual(change);
      expect(state.isSyncing).toBe(false);

      // Advance timers to trigger flush
      vi.advanceTimersByTime(300);
      await vi.waitFor(() => {
        expect(mockOnSync).toHaveBeenCalledWith([change], undefined, expect.any(AbortSignal));
      });
    });

    it("should coalesce create + update into single create", () => {
      syncQueue = new SyncQueue({
        debounce: 300,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      const change1: Change<TestItem> = {
        id: "1",
        type: "create",
        data: { id: "1", value: "first" },
      };

      const change2: Change<TestItem> = {
        id: "1",
        type: "update",
        data: { id: "1", value: "second" },
      };

      syncQueue.enqueue(change1);
      syncQueue.enqueue(change2);

      const state = syncQueue.getState();
      expect(state.queue.size).toBe(1);
      // Should coalesce create + update into single create with updated data
      expect(state.queue.get("1")).toEqual({ ...change1, data: change2.data });
    });

    it("should clear error when enqueueing a previously failed item", async () => {
      mockOnSync.mockResolvedValue({ "1": { status: "error", error: "Failed" } });
      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      const change: Change<TestItem> = {
        id: "1",
        type: "create",
        data: { id: "1", value: "test" },
      };

      // First attempt - will fail
      syncQueue.enqueue(change);
      vi.advanceTimersByTime(50);

      // Wait for it to process and set error
      await vi.waitFor(() => {
        const state = syncQueue.getState();
        expect(state.errors.has("1")).toBe(true);
      });

      // Enqueue again - should clear error
      syncQueue.enqueue(change);
      const newState = syncQueue.getState();
      expect(newState.errors.has("1")).toBe(false);
    });
  });

  describe("Re-entry Scenarios", () => {
    it("should queue changes for in-flight items for next batch", async () => {
      let resolveSync: (value: Record<string, Result>) => void;
      const syncPromise = new Promise<Record<string, Result>>((resolve) => {
        resolveSync = resolve;
      });
      mockOnSync.mockReturnValue(syncPromise);

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      const change1: Change<TestItem> = {
        id: "1",
        type: "create",
        data: { id: "1", value: "first" },
      };

      // Enqueue and trigger flush
      syncQueue.enqueue(change1);
      vi.advanceTimersByTime(50);

      // Item is now in-flight
      let state = syncQueue.getState();
      expect(state.inFlight.size).toBe(1);
      expect(state.isSyncing).toBe(true);

      // Enqueue another change for same item while in-flight
      const change2: Change<TestItem> = {
        id: "1",
        type: "update",
        data: { id: "1", value: "second" },
      };
      syncQueue.enqueue(change2);

      // Should be in queue for next batch
      state = syncQueue.getState();
      expect(state.queue.size).toBe(1);
      expect(state.queue.get("1")).toEqual(change2);
      expect(state.inFlight.size).toBe(1);

      // Complete sync
      resolveSync!({ "1": { status: "success" } });
      await vi.waitFor(() => {
        const finalState = syncQueue.getState();
        expect(finalState.isSyncing).toBe(false);
        expect(finalState.inFlight.size).toBe(0);
      });
    });

    it("should handle multiple updates to same item during sync", async () => {
      let resolveSync: (value: Record<string, Result>) => void;
      const syncPromise = new Promise<Record<string, Result>>((resolve) => {
        resolveSync = resolve;
      });
      mockOnSync.mockReturnValue(syncPromise);

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      // Start sync
      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "v1" } });
      vi.advanceTimersByTime(50);

      // Multiple updates while syncing
      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "v2" } });
      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "v3" } });
      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "v4" } });

      const state = syncQueue.getState();
      expect(state.queue.size).toBe(1);
      const queuedChange = state.queue.get("1");
      expect(queuedChange).toBeDefined();
      expect(queuedChange!.data.value).toBe("v4"); // Latest value (coalesced)

      // Complete sync
      resolveSync!({ "1": { status: "success" } });
      await vi.waitFor(() => {
        expect(syncQueue.getState().isSyncing).toBe(false);
      });
    });

    it("should not schedule flush while already syncing", async () => {
      let resolveSync1: (value: Record<string, Result>) => void;
      const syncPromise1 = new Promise<Record<string, Result>>((resolve) => {
        resolveSync1 = resolve;
      });

      mockOnSync
        .mockReturnValueOnce(syncPromise1)
        .mockResolvedValue({ "2": { status: "success" } });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      // Start first sync
      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });
      vi.advanceTimersByTime(50);

      expect(mockOnSync).toHaveBeenCalledTimes(1);
      expect(syncQueue.getState().isSyncing).toBe(true);

      // Try to enqueue for a different item while syncing
      syncQueue.enqueue({ id: "2", type: "create", data: { id: "2", value: "test2" } });
      vi.advanceTimersByTime(100);

      // Should not call onSync again while still syncing
      expect(mockOnSync).toHaveBeenCalledTimes(1);

      // Complete first sync
      resolveSync1!({ "1": { status: "success" } });
      await vi.waitFor(() => {
        expect(syncQueue.getState().isSyncing).toBe(false);
      });

      // Now should trigger for queued item
      vi.advanceTimersByTime(50);

      await vi.waitFor(
        () => {
          expect(mockOnSync).toHaveBeenCalledTimes(2);
        },
        { timeout: 2000 },
      );
    });
  });

  describe("Failure Recovery and Retry", () => {
    it("should retry failed items up to maxRetries", async () => {
      let callCount = 0;
      mockOnSync.mockImplementation(async () => {
        callCount++;
        return { "1": { status: "error", error: `Attempt ${callCount}` } };
      });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });

      // First attempt
      vi.advanceTimersByTime(50);
      await vi.waitFor(() => expect(mockOnSync).toHaveBeenCalledTimes(1));

      // Second attempt (retry 1)
      vi.advanceTimersByTime(50);
      await vi.waitFor(() => expect(mockOnSync).toHaveBeenCalledTimes(2));

      // Third attempt (retry 2)
      vi.advanceTimersByTime(50);
      await vi.waitFor(() => expect(mockOnSync).toHaveBeenCalledTimes(3));

      // Should stop after maxRetries (3 total attempts)
      vi.advanceTimersByTime(100);
      expect(mockOnSync).toHaveBeenCalledTimes(3);

      const state = syncQueue.getState();
      expect(state.errors.get("1")?.retries).toBe(3);
      expect(state.queue.has("1")).toBe(false); // No longer in queue
    });

    it("should track retry count correctly", async () => {
      mockOnSync.mockResolvedValue({ "1": { status: "error", error: "Failed" } });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 5,
        onSync: mockOnSync,
      });

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });

      vi.advanceTimersByTime(50);
      await vi.waitFor(() => {
        expect(syncQueue.getState().errors.get("1")?.retries).toBe(1);
      });

      vi.advanceTimersByTime(50);
      await vi.waitFor(() => {
        expect(syncQueue.getState().errors.get("1")?.retries).toBe(2);
      });

      vi.advanceTimersByTime(50);
      await vi.waitFor(() => {
        expect(syncQueue.getState().errors.get("1")?.retries).toBe(3);
      });
    });

    it("should handle partial batch failures correctly", async () => {
      mockOnSync.mockResolvedValue({
        "1": { status: "success" },
        "2": { status: "error", error: "Failed" },
        "3": { status: "success" },
      });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test1" } });
      syncQueue.enqueue({ id: "2", type: "create", data: { id: "2", value: "test2" } });
      syncQueue.enqueue({ id: "3", type: "create", data: { id: "3", value: "test3" } });

      vi.advanceTimersByTime(50);

      // Wait for all auto-retries of item 2 to complete
      await vi.waitFor(
        () => {
          const state = syncQueue.getState();
          expect(state.errors.has("1")).toBe(false);
          expect(state.errors.has("2")).toBe(true);
          expect(state.errors.has("3")).toBe(false);
          expect(state.errors.get("2")?.retries).toBe(3); // Maxed out retries
          expect(state.queue.has("2")).toBe(false); // No longer queued after max retries
        },
        { timeout: 5000 },
      );
    });

    it("should handle sync function throwing error", async () => {
      mockOnSync.mockRejectedValue(new Error("Network error"));

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test1" } });
      syncQueue.enqueue({ id: "2", type: "create", data: { id: "2", value: "test2" } });

      vi.advanceTimersByTime(50);

      // Wait for all auto-retries to complete (will retry maxRetries times)
      await vi.waitFor(
        () => {
          const state = syncQueue.getState();
          expect(state.isSyncing).toBe(false);
          expect(state.errors.size).toBe(2);
          expect(state.errors.get("1")?.error).toBe("Network error");
          expect(state.errors.get("2")?.error).toBe("Network error");
          expect(state.errors.get("1")?.retries).toBe(3); // Maxed out retries
          expect(state.errors.get("2")?.retries).toBe(3); // Maxed out retries
          expect(state.queue.size).toBe(0); // No longer in queue after max retries
        },
        { timeout: 5000 },
      );
    });

    it("should retry all items after retryAll()", async () => {
      mockOnSync
        .mockResolvedValueOnce({
          "1": { status: "error", error: "Failed" },
          "2": { status: "error", error: "Failed" },
        })
        .mockResolvedValueOnce({
          "1": { status: "success" },
          "2": { status: "success" },
        });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test1" } });
      syncQueue.enqueue({ id: "2", type: "create", data: { id: "2", value: "test2" } });

      vi.advanceTimersByTime(50);

      await vi.waitFor(() => {
        const state = syncQueue.getState();
        expect(state.errors.size).toBe(2);
      });

      // Retry all
      syncQueue.retryAll();
      vi.advanceTimersByTime(50);

      await vi.waitFor(() => {
        const state = syncQueue.getState();
        expect(state.errors.size).toBe(0);
        expect(state.queue.size).toBe(0);
      });
    });

    it("should retry specific item with retry(id)", async () => {
      mockOnSync
        .mockResolvedValueOnce({
          "1": { status: "error", error: "Failed" },
          "2": { status: "error", error: "Failed" },
        })
        .mockResolvedValueOnce({ "1": { status: "success" } });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test1" } });
      syncQueue.enqueue({ id: "2", type: "create", data: { id: "2", value: "test2" } });

      vi.advanceTimersByTime(50);

      await vi.waitFor(() => {
        const state = syncQueue.getState();
        expect(state.errors.size).toBe(2);
      });

      // Retry only item 1
      syncQueue.retry("1");
      vi.advanceTimersByTime(50);

      await vi.waitFor(() => {
        const state = syncQueue.getState();
        expect(state.errors.has("1")).toBe(false);
        expect(state.errors.has("2")).toBe(true); // Item 2 still has error
      });
    });
  });

  describe("Pause and Resume", () => {
    it("should pause syncing", () => {
      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.pause();

      const state = syncQueue.getState();
      expect(state.isPaused).toBe(true);
    });

    it("should not flush when paused", async () => {
      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.pause();
      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });

      vi.advanceTimersByTime(100);

      expect(mockOnSync).not.toHaveBeenCalled();
      expect(syncQueue.getState().queue.size).toBe(1);
    });

    it("should resume and flush pending items", async () => {
      mockOnSync.mockResolvedValue({ "1": { status: "success" } });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.pause();
      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });

      expect(syncQueue.getState().queue.size).toBe(1);

      syncQueue.resume();
      vi.advanceTimersByTime(50);

      expect(mockOnSync).toHaveBeenCalled();
    });

    it("should not interrupt in-flight sync when paused", async () => {
      let resolveSync: (value: Record<string, Result>) => void;
      const syncPromise = new Promise<Record<string, Result>>((resolve) => {
        resolveSync = resolve;
      });
      mockOnSync.mockReturnValue(syncPromise);

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });
      vi.advanceTimersByTime(50);

      expect(syncQueue.getState().isSyncing).toBe(true);

      // Pause while syncing
      syncQueue.pause();

      // Complete sync
      resolveSync!({ "1": { status: "success" } });

      await vi.waitFor(() => {
        expect(syncQueue.getState().isSyncing).toBe(false);
      });
    });
  });

  describe("Debouncing", () => {
    it("should debounce multiple enqueues", async () => {
      mockOnSync.mockResolvedValue({ "1": { status: "success" } });

      syncQueue = new SyncQueue({
        debounce: 100,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "v1" } });
      vi.advanceTimersByTime(50);

      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "v2" } });
      vi.advanceTimersByTime(50);

      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "v3" } });

      // Should not have called onSync yet
      expect(mockOnSync).not.toHaveBeenCalled();

      // Wait for debounce
      vi.advanceTimersByTime(100);

      // Should have called once with latest value (create + updates coalesced into create)
      expect(mockOnSync).toHaveBeenCalledTimes(1);
      expect(mockOnSync).toHaveBeenCalledWith(
        [{ id: "1", type: "create", data: { id: "1", value: "v3" } }],
        undefined,
        expect.any(AbortSignal),
      );
    });

    it("should reset debounce timer on new enqueue", async () => {
      mockOnSync.mockResolvedValue({ "1": { status: "success" } });

      syncQueue = new SyncQueue({
        debounce: 100,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });
      vi.advanceTimersByTime(90);

      // Add another change before debounce completes
      syncQueue.enqueue({ id: "2", type: "create", data: { id: "2", value: "test2" } });

      // Still shouldn't have called
      expect(mockOnSync).not.toHaveBeenCalled();

      // Wait for new debounce
      vi.advanceTimersByTime(100);

      expect(mockOnSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("Subscription", () => {
    it("should notify subscribers on state changes", () => {
      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      const subscriber = vi.fn();
      syncQueue.subscribe(subscriber);

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });

      expect(subscriber).toHaveBeenCalled();
    });

    it("should allow unsubscribing", () => {
      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      const subscriber = vi.fn();
      const unsubscribe = syncQueue.subscribe(subscriber);

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });
      expect(subscriber).toHaveBeenCalledTimes(1);

      unsubscribe();
      subscriber.mockClear();

      syncQueue.enqueue({ id: "2", type: "create", data: { id: "2", value: "test2" } });
      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe("State Management", () => {
    it("should return immutable state", () => {
      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      const state1 = syncQueue.getState();
      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });
      const state2 = syncQueue.getState();

      expect(state1).not.toBe(state2);
      expect(state1.queue.size).toBe(0);
      expect(state2.queue.size).toBe(1);
    });

    it("should maintain correct state during complex flow", async () => {
      let syncCount = 0;
      mockOnSync.mockImplementation(async () => {
        syncCount++;
        if (syncCount === 1) {
          return {
            "1": { status: "success" },
            "2": { status: "error", error: "Failed" },
          };
        }
        return { "2": { status: "success" } };
      });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      // Enqueue two items
      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test1" } });
      syncQueue.enqueue({ id: "2", type: "create", data: { id: "2", value: "test2" } });

      let state = syncQueue.getState();
      expect(state.queue.size).toBe(2);
      expect(state.inFlight.size).toBe(0);
      expect(state.isSyncing).toBe(false);

      // Flush
      vi.advanceTimersByTime(50);

      // First sync completes - item 1 succeeds, item 2 fails and auto-retries
      // Wait for item 2's retry (second sync) to complete successfully
      await vi.waitFor(
        () => {
          state = syncQueue.getState();
          expect(state.isSyncing).toBe(false);
          expect(state.queue.size).toBe(0); // All items processed
          expect(state.inFlight.size).toBe(0);
          expect(state.errors.size).toBe(0); // Item 2 succeeded on retry
        },
        { timeout: 5000 },
      );
    });
  });

  describe("Operation Coalescing", () => {
    it("should coalesce create + update into single create", async () => {
      const capturedChanges: Change<TestItem>[] = [];
      mockOnSync.mockImplementation(async (changes: Change<TestItem>[]) => {
        capturedChanges.push(...changes);
        const results: Record<string, Result> = {};
        for (const c of changes) results[c.id] = { status: "success" };
        return results;
      });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      // Create then update before flush
      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "v1" } });
      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "v2" } });

      vi.advanceTimersByTime(50);

      await vi.waitFor(() => {
        expect(mockOnSync).toHaveBeenCalledTimes(1);
      });

      // Should send single create with final data
      expect(capturedChanges.length).toBe(1);
      expect(capturedChanges[0]).toEqual({
        id: "1",
        type: "create",
        data: { id: "1", value: "v2" },
      });
    });

    it("should coalesce multiple updates into single update", async () => {
      const capturedChanges: Change<TestItem>[] = [];
      mockOnSync.mockImplementation(async (changes: Change<TestItem>[]) => {
        capturedChanges.push(...changes);
        const results: Record<string, Result> = {};
        for (const c of changes) results[c.id] = { status: "success" };
        return results;
      });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      // Multiple updates before flush
      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "v1" } });
      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "v2" } });
      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "v3" } });

      vi.advanceTimersByTime(50);

      await vi.waitFor(() => {
        expect(mockOnSync).toHaveBeenCalledTimes(1);
      });

      // Should send single update with final data
      expect(capturedChanges.length).toBe(1);
      expect(capturedChanges[0]).toEqual({
        id: "1",
        type: "update",
        data: { id: "1", value: "v3" },
      });
    });

    it("should cancel create + delete (net zero)", async () => {
      mockOnSync.mockResolvedValue({});

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      // Create then delete before flush
      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });
      syncQueue.enqueue({ id: "1", type: "delete", data: { id: "1", value: "test" } });

      vi.advanceTimersByTime(50);

      // Wait for debounce period to complete
      await vi.runAllTimersAsync();

      // Should not call onSync - net zero operation
      expect(mockOnSync).not.toHaveBeenCalled();
      expect(syncQueue.getState().queue.size).toBe(0);
    });

    it("should coalesce update + delete into just delete", async () => {
      const capturedChanges: Change<TestItem>[] = [];
      mockOnSync.mockImplementation(async (changes: Change<TestItem>[]) => {
        capturedChanges.push(...changes);
        const results: Record<string, Result> = {};
        for (const c of changes) results[c.id] = { status: "success" };
        return results;
      });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      // Update then delete before flush
      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "updated" } });
      syncQueue.enqueue({ id: "1", type: "delete", data: { id: "1", value: "updated" } });

      vi.advanceTimersByTime(50);

      await vi.waitFor(() => {
        expect(mockOnSync).toHaveBeenCalledTimes(1);
      });

      // Should send just the delete operation (update + delete coalesced to delete)
      expect(capturedChanges.length).toBe(1);
      expect(capturedChanges[0].type).toBe("delete");
    });

    it("should coalesce create + update + delete into nothing", async () => {
      mockOnSync.mockResolvedValue({});

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      // Create, update, then delete before flush
      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "v1" } });
      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "v2" } });
      syncQueue.enqueue({ id: "1", type: "delete", data: { id: "1", value: "v2" } });

      vi.advanceTimersByTime(50);

      // Wait for debounce period to complete
      await vi.runAllTimersAsync();

      // Should not call onSync - net zero operation
      expect(mockOnSync).not.toHaveBeenCalled();
      expect(syncQueue.getState().queue.size).toBe(0);
    });

    it("should preserve operation order across different items", async () => {
      const capturedChanges: Change<TestItem>[] = [];
      mockOnSync.mockImplementation(async (changes: Change<TestItem>[]) => {
        capturedChanges.push(...changes);
        const results: Record<string, Result> = {};
        for (const c of changes) results[c.id] = { status: "success" };
        return results;
      });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      // Mix operations for different items
      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "a" } });
      syncQueue.enqueue({ id: "2", type: "create", data: { id: "2", value: "b" } });
      syncQueue.enqueue({ id: "1", type: "update", data: { id: "1", value: "c" } });
      syncQueue.enqueue({ id: "2", type: "delete", data: { id: "2", value: "b" } });

      vi.advanceTimersByTime(50);

      await vi.waitFor(() => {
        expect(mockOnSync).toHaveBeenCalledTimes(1);
      });

      // Item 1: create with updated data
      // Item 2: nothing (create + delete canceled out)
      expect(capturedChanges.length).toBe(1);
      expect(capturedChanges[0]).toEqual({
        id: "1",
        type: "create",
        data: { id: "1", value: "c" },
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty onSync results", async () => {
      mockOnSync.mockResolvedValue({});

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });

      vi.advanceTimersByTime(50);

      await vi.waitFor(() => {
        const state = syncQueue.getState();
        expect(state.isSyncing).toBe(false);
        // Item should be marked as error since no result was returned
        expect(state.errors.has("1")).toBe(true);
      });
    });

    it("should handle concurrent enqueues during flush", async () => {
      let resolveSync: (value: Record<string, Result>) => void;
      const syncPromise = new Promise<Record<string, Result>>((resolve) => {
        resolveSync = resolve;
      });
      mockOnSync.mockReturnValue(syncPromise);

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 3,
        onSync: mockOnSync,
      });

      // Start flush
      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });
      vi.advanceTimersByTime(50);

      // Enqueue multiple items during sync
      syncQueue.enqueue({ id: "2", type: "create", data: { id: "2", value: "test2" } });
      syncQueue.enqueue({ id: "3", type: "create", data: { id: "3", value: "test3" } });

      const state = syncQueue.getState();
      expect(state.queue.size).toBe(2);
      expect(state.inFlight.size).toBe(1);

      // Complete sync
      resolveSync!({ "1": { status: "success" } });

      await vi.waitFor(() => {
        expect(syncQueue.getState().isSyncing).toBe(false);
      });
    });

    it("should handle resetRetries correctly", async () => {
      mockOnSync.mockResolvedValue({ "1": { status: "error", error: "Failed" } });

      syncQueue = new SyncQueue({
        debounce: 50,
        maxRetries: 5,
        onSync: mockOnSync,
      });

      syncQueue.enqueue({ id: "1", type: "create", data: { id: "1", value: "test" } });

      vi.advanceTimersByTime(50);
      await vi.waitFor(() => {
        expect(syncQueue.getState().errors.get("1")?.retries).toBe(1);
      });

      vi.advanceTimersByTime(50);
      await vi.waitFor(() => {
        expect(syncQueue.getState().errors.get("1")?.retries).toBe(2);
      });

      // Reset retries
      syncQueue.resetRetries("1");
      expect(syncQueue.getState().errors.get("1")?.retries).toBe(0);
    });
  });
});
