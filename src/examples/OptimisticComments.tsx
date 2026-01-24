import React, { useCallback, useState } from "react";
import { useCrud, type Config, type SyncResult } from "../useCrud";

interface Comment {
  id: string;
  postId: string;
  text: string;
  author: string;
  createdAt: string;
}

interface CommentContext {
  postId: string;
}

const CommentsConfig: Config<Comment, CommentContext> = {
  id: "comments-optimistic",
  initialContext: {
    postId: "1",
  },
  getId: (item) => item.id,

  // Very short debounce to show optimistic updates quickly
  syncDebounce: 100,
  syncRetries: 3,
  cacheCapacity: 5,
  cacheTtl: 30000,

  onFetch: async (context, signal) => {
    const params = new URLSearchParams({
      postId: context.postId,
    });

    const response = await fetch(`/api/comments?${params}`, { signal });
    const data = await response.json();

    return data.items;
  },

  onSync: async (changes, _context, signal) => {
    const results: SyncResult[] = [];

    for (const change of changes) {
      try {
        if (change.type === "create") {
          const response = await fetch("/api/comments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(change.data),
            signal,
          });

          if (!response.ok) throw new Error("Failed to create comment");
          const data = await response.json();
          // Return newId so the library can remap the temporary ID to the server-assigned ID
          results.push({ id: change.id, status: "success", newId: data.id });
        } else if (change.type === "update") {
          const response = await fetch(`/api/comments/${change.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(change.data),
            signal,
          });

          if (!response.ok) throw new Error("Failed to update comment");
          results.push({ id: change.id, status: "success" });
        } else if (change.type === "delete") {
          const response = await fetch(`/api/comments/${change.id}`, {
            method: "DELETE",
            signal,
          });

          if (!response.ok) throw new Error("Failed to delete comment");
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

export const OptimisticComments = React.memo(function OptimisticComments() {
  const {
    items,
    loading,
    syncing,
    syncQueue,
    create,
    update,
    remove,
    getItemStatus,
    pauseSync,
    resumeSync,
    retrySync,
  } = useCrud<Comment, CommentContext>(CommentsConfig);

  const [newCommentText, setNewCommentText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const comments = Array.from(items.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const handleAddComment = useCallback(() => {
    if (!newCommentText.trim()) {
      alert("Comment text is required");
      return;
    }

    // Optimistic create - immediately shows in UI
    create({
      id: `temp-${Date.now()}`,
      postId: "1",
      text: newCommentText,
      author: "You",
      createdAt: new Date().toISOString(),
    });

    setNewCommentText("");
  }, [newCommentText, create]);

  const handleEditComment = useCallback((comment: Comment) => {
    setEditingId(comment.id);
    setEditText(comment.text);
  }, []);

  const handleSaveEdit = useCallback(
    (id: string) => {
      // Optimistic update - immediately shows in UI
      update(id, (draft) => {
        draft.text = editText;
      });
      setEditingId(null);
      setEditText("");
    },
    [editText, update],
  );

  const handleDeleteComment = useCallback(
    (comment: Comment) => {
      if (confirm("Delete this comment?")) {
        // Optimistic delete - immediately removes from UI
        remove(comment.id);
      }
    },
    [remove],
  );

  const hasErrors = syncQueue.errors.size > 0;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Optimistic Updates Demo</h1>

      {/* Sync queue status */}
      <div className="mb-6 p-4 bg-gray-100 rounded">
        <h2 className="font-bold mb-2">Sync Queue Status</h2>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Pending changes:</span>
            <span className="font-semibold">{syncQueue.queue.size}</span>
          </div>
          <div className="flex justify-between">
            <span>In flight:</span>
            <span className="font-semibold">{syncQueue.inFlight.size}</span>
          </div>
          <div className="flex justify-between">
            <span>Errors:</span>
            <span className={`font-semibold ${hasErrors ? "text-red-600" : ""}`}>
              {syncQueue.errors.size}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Sync status:</span>
            <span className={`font-semibold ${syncing ? "text-blue-600" : ""}`}>
              {syncing ? "Syncing..." : "Idle"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Queue paused:</span>
            <span className="font-semibold">{syncQueue.isPaused ? "Yes" : "No"}</span>
          </div>
        </div>

        <div className="flex gap-2 mt-3">
          {syncQueue.isPaused ? (
            <button
              type="button"
              onClick={resumeSync}
              className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600 text-sm"
            >
              Resume Sync
            </button>
          ) : (
            <button
              type="button"
              onClick={pauseSync}
              className="bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600 text-sm"
            >
              Pause Sync
            </button>
          )}
          {hasErrors && (
            <button
              type="button"
              onClick={() => retrySync()}
              className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 text-sm"
            >
              Retry All Errors
            </button>
          )}
        </div>
      </div>

      {/* Add comment form */}
      <div className="mb-6 p-4 border rounded bg-white">
        <h2 className="font-bold mb-3">Add Comment</h2>
        <textarea
          value={newCommentText}
          onChange={(e) => setNewCommentText(e.target.value)}
          placeholder="Write your comment..."
          className="w-full border px-3 py-2 rounded mb-2"
          rows={3}
        />
        <button
          type="button"
          onClick={handleAddComment}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Add Comment (Optimistic)
        </button>
        <p className="text-xs text-gray-500 mt-2">
          Note: The comment will appear immediately in the list below while syncing in the
          background.
        </p>
      </div>

      {/* Comments list */}
      <div className="space-y-3">
        <h2 className="font-bold text-xl mb-3">Comments ({comments.length})</h2>

        {loading && comments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">Loading comments...</div>
        ) : comments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No comments yet</div>
        ) : (
          comments.map((comment) => {
            const status = getItemStatus(comment.id);
            const isEditing = editingId === comment.id;

            return (
              <div
                key={comment.id}
                className={`p-4 border rounded bg-white ${
                  status?.status === "error"
                    ? "border-red-300 bg-red-50"
                    : status?.status === "pending"
                      ? "border-yellow-300 bg-yellow-50"
                      : ""
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="font-semibold">{comment.author}</span>
                    <span className="text-xs text-gray-500 ml-2">
                      {new Date(comment.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {status && (
                    <div className="flex items-center gap-2">
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
                        {status.status === "pending" && "Pending"}
                        {status.status === "error" && `Error: ${status.error || "Failed"}`}
                        {status.status === "success" && "Synced"}
                      </span>
                      {status.retries > 0 && (
                        <span className="text-xs text-gray-500">(Retry {status.retries})</span>
                      )}
                      {status.status === "error" && (
                        <button
                          type="button"
                          onClick={() => retrySync(comment.id)}
                          className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full border px-3 py-2 rounded mb-2"
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(comment.id)}
                        className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 text-sm"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="bg-gray-300 px-3 py-1 rounded hover:bg-gray-400 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-gray-700 mb-2">{comment.text}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleEditComment(comment)}
                        disabled={status?.status === "syncing"}
                        className="text-sm text-blue-600 hover:underline disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteComment(comment)}
                        disabled={status?.status === "syncing"}
                        className="text-sm text-red-600 hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Info panel */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
        <h3 className="font-bold text-sm mb-2">How Optimistic Updates Work</h3>
        <ul className="text-sm space-y-1 text-gray-700">
          <li>• Changes appear instantly in the UI before server confirmation</li>
          <li>• The sync queue manages background synchronization</li>
          <li>• Failed operations are automatically retried</li>
          <li>• You can pause/resume sync or manually retry errors</li>
          <li>• Visual indicators show the sync status of each item</li>
        </ul>
      </div>
    </div>
  );
});
