import React, { useCallback, useState } from "react";
import { useCrud, type Config } from "../useCrud";
import { createLocalSyncClient, useLocalSyncState } from "../runtime/local";

interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

const localClient = createLocalSyncClient<Note>({
  dbName: "local-notes",
  collectionId: "local-notes",
  remoteSyncEndpoint: "/api/notes",
  debounce: 500,
  maxRetries: 3,
});

const NotesConfig: Config<Note, Record<string, never>> = {
  id: "local-notes",
  initialContext: {} as Record<string, never>,
  handler: localClient.handler,
};

export const LocalNotes = React.memo(function LocalNotes() {
  const { items, loading, create, update, remove } = useCrud<Note, Record<string, never>>(
    NotesConfig,
  );
  const syncState = useLocalSyncState("local-notes", localClient);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const notes = Array.from(items.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const handleCreate = useCallback(() => {
    create({
      title: "Untitled note",
      body: "",
      updatedAt: new Date().toISOString(),
    });
  }, [create]);

  const handleStartEdit = useCallback((note: Note) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditBody(note.body);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    update(editingId, (draft) => {
      draft.title = editTitle;
      draft.body = editBody;
      draft.updatedAt = new Date().toISOString();
    });
    setEditingId(null);
  }, [editingId, editTitle, editBody, update]);

  const handleDelete = useCallback(
    (id: string) => {
      if (confirm("Delete this note?")) {
        remove(id);
        if (editingId === id) setEditingId(null);
      }
    },
    [remove, editingId],
  );

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Local-First Notes</h1>

      {/* Sync status bar */}
      <div className="bg-gray-100 p-3 rounded mb-4">
        <div className="flex justify-between items-center">
          <div className="flex gap-4 text-sm">
            <span>{notes.length} notes</span>
            {syncState.isSyncing && <span className="text-blue-600">Syncing to server...</span>}
            {syncState.queue.size > 0 && !syncState.isSyncing && (
              <span className="text-yellow-600">{syncState.queue.size} pending</span>
            )}
            {syncState.errors.size > 0 && (
              <span className="text-red-600">{syncState.errors.size} errors</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={syncState.refetch}
              className="text-sm bg-gray-300 px-3 py-1 rounded hover:bg-gray-400"
            >
              Refresh
            </button>
            {syncState.isPaused ? (
              <button
                type="button"
                onClick={syncState.resumeSync}
                className="text-sm bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
              >
                Resume Sync
              </button>
            ) : (
              <button
                type="button"
                onClick={syncState.pauseSync}
                className="text-sm bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600"
              >
                Pause Sync
              </button>
            )}
            {syncState.errors.size > 0 && (
              <button
                type="button"
                onClick={() => syncState.retrySync()}
                className="text-sm bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
              >
                Retry All
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Create button */}
      <button
        type="button"
        onClick={handleCreate}
        className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 mb-4"
      >
        New Note
      </button>

      {/* Notes list */}
      {loading && notes.length === 0 ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : notes.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No notes yet</div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => {
            const isEditing = editingId === note.id;

            return (
              <div key={note.id} className="p-4 border rounded bg-white">
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="border px-3 py-2 rounded font-bold"
                      placeholder="Title"
                    />
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="border px-3 py-2 rounded"
                      rows={4}
                      placeholder="Write something..."
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSaveEdit}
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
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-lg">{note.title}</h3>
                      <span className="text-xs text-gray-400">
                        {new Date(note.updatedAt).toLocaleString()}
                      </span>
                    </div>
                    {note.body && (
                      <p className="text-gray-700 mb-3 whitespace-pre-wrap">{note.body}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(note)}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(note.id)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Info panel */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
        <h3 className="font-bold text-sm mb-2">How Local-First Works</h3>
        <ul className="text-sm space-y-1 text-gray-700">
          <li>All data is stored in IndexedDB — works fully offline</li>
          <li>Changes are written to IDB first, then synced to the server in the background</li>
          <li>On reconnect, unsynced changes are automatically pushed to the server</li>
          <li>Delta sync via lastSyncedAt — only fetches items updated since the last sync</li>
        </ul>
      </div>
    </div>
  );
});
