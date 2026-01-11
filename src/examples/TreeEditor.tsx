import React, { useCallback, useState } from "react";
import { useCrudTree, type TreeConfig } from "../useCrudTree";
import { useNode } from "../useNode";
import { useSelectedNode } from "../useSelectedNode";
import type { TreeNode, Node } from "../node";

interface FileData {
  name: string;
  content?: string;
}

type FileContext = Record<string, never>;

const TREE_ID = "file-tree";

// Initial tree data simulating a file system
const initialTreeData: TreeNode<FileData>[] = [
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

let nodeCounter = 0;

const TreeConfig: TreeConfig<FileData, FileContext> = {
  id: TREE_ID,
  initialContext: {},
  getId: (item) => item.id,
  rootId: "root",
  getNodeId: () => `node-${++nodeCounter}`,
  onFetch: async () => initialTreeData,
};

// Recursive tree node component
const TreeNodeItem = React.memo(function TreeNodeItem({
  node,
  depth = 0,
}: {
  node: Node<FileData, FileContext>;
  depth?: number;
}) {
  const { data, isSelected, select, children } = useNode<FileData, FileContext>(node);

  if (!data) return null;

  const isFolder = data.type === "object";
  const indent = depth * 16;

  return (
    <div>
      <div
        onClick={() => select()}
        className={`flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-gray-100 rounded ${
          isSelected ? "bg-blue-100 text-blue-800" : ""
        }`}
        style={{ paddingLeft: `${indent + 8}px` }}
      >
        <span className="text-gray-500">{isFolder ? "📁" : "📄"}</span>
        <span className={isFolder ? "font-medium" : ""}>{data.value.name}</span>
      </div>
      {isFolder && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeNodeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
});

// Edit panel component using useSelectedNode
function EditPanel() {
  const { isPresent, data, depth, updateProp, append, remove, deselect } = useSelectedNode<
    FileData,
    FileContext
  >(TREE_ID);
  const [editedName, setEditedName] = useState("");
  const [editedContent, setEditedContent] = useState("");
  const [newItemName, setNewItemName] = useState("");

  // Sync local state when selection changes
  React.useEffect(() => {
    if (data) {
      setEditedName(data.value.name);
      setEditedContent(data.value.content ?? "");
    }
  }, [data]);

  const handleSave = useCallback(() => {
    updateProp((draft) => {
      draft.name = editedName;
      draft.content = editedContent || undefined;
    });
  }, [updateProp, editedName, editedContent]);

  const handleAddChild = useCallback(() => {
    if (!newItemName.trim()) return;

    const isFile = newItemName.includes(".");
    append(
      { name: newItemName, content: isFile ? "" : undefined },
      isFile ? "primitive" : "object",
    );
    setNewItemName("");
  }, [append, newItemName]);

  const handleDelete = useCallback(() => {
    if (isPresent && data && confirm(`Delete "${data.value.name}"?`)) {
      remove();
      deselect();
    }
  }, [isPresent, data, remove, deselect]);

  if (!isPresent || !data) {
    return (
      <div className="p-4 text-gray-500 text-center">
        <p>Select a file or folder to edit</p>
      </div>
    );
  }

  const isFolder = data.type === "object";
  const isRoot = depth === 0;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 border-b pb-3">
        <span className="text-2xl">{isFolder ? "📁" : "📄"}</span>
        <h2 className="text-xl font-bold">{data.value.name}</h2>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            className="w-full border px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isRoot}
          />
        </div>

        {!isFolder && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              rows={8}
              className="w-full border px-3 py-2 rounded font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Save Changes
          </button>
          {!isRoot && (
            <button
              onClick={handleDelete}
              className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {isFolder && (
        <div className="border-t pt-4 mt-4">
          <h3 className="font-medium mb-2">Add Child</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="e.g., 'folder' or 'file.ts'"
              className="flex-1 border px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleAddChild}
              disabled={!newItemName.trim()}
              className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Include extension (e.g., .ts) for files, omit for folders
          </p>
        </div>
      )}

      <div className="border-t pt-4 mt-4 text-xs text-gray-500">
        <p>Node ID: {data.id}</p>
        <p>Type: {data.type}</p>
        <p>Position: {data.position}</p>
      </div>
    </div>
  );
}

export const TreeEditor = React.memo(function TreeEditor() {
  const { loading, rootNode } = useCrudTree<FileData, FileContext>(TreeConfig);

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Tree Editor (useNode Demo)</h1>
      <p className="text-gray-600 mb-6">
        Click on a file or folder to select it, then edit in the panel on the right. This
        demonstrates <code className="bg-gray-100 px-1 rounded">useNode</code> for tree rendering
        and <code className="bg-gray-100 px-1 rounded">useSelectedNode</code> for the edit panel.
      </p>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading tree...</div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {/* Tree View */}
          <div className="border rounded-lg bg-white overflow-hidden">
            <div className="bg-gray-100 px-4 py-2 border-b font-medium">File Tree</div>
            <div className="p-2">{rootNode && <TreeNodeItem node={rootNode} />}</div>
          </div>

          {/* Edit Panel */}
          <div className="border rounded-lg bg-white overflow-hidden">
            <div className="bg-gray-100 px-4 py-2 border-b font-medium">Edit Panel</div>
            <EditPanel />
          </div>
        </div>
      )}
    </div>
  );
});
