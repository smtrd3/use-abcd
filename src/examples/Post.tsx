import { useCallback, useState, type ChangeEvent } from "react";
import { useCrud } from "../useCrud";

interface Post {
  id: string;
  title: string;
  content: string;
  liked?: boolean;
}

const PostsConfig = {
  id: "post",
  context: {},
  fetch: async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    return {
      items: [{ id: "one", title: "Hello world!", content: "This is my first post" }],
      metadata: {},
    };
  },
  update: async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 3000);
    });
    return { id: "one" };
  },
};

function Post() {
  const { items, isLoading, update } = useCrud<Post>(PostsConfig);

  const [isEdit, setIsEdit] = useState(false);
  const [editContent, setEditContent] = useState("");

  const post = items.at(0);

  const onLike = useCallback(() => {
    if (post) {
      update(post, (draft) => {
        draft.liked = true;
      });
    }
  }, [post, update]);

  const onChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setEditContent(e.target.value);
  }, []);

  const onUpdate = useCallback(() => {
    if (post) {
      update(post, (draft) => {
        draft.content = editContent;
      });
    }
    setIsEdit(false);
  }, [post, update, editContent]);

  const onEdit = useCallback(() => {
    setIsEdit((curr) => !curr);
    setEditContent(post.data.content);
  }, [setIsEdit, setEditContent, post]);

  if (isLoading || !post) {
    return <div>Loading.....</div>;
  }

  return (
    <div className="p-2">
      <h1 className="font-bold text-3xl">{post.data.title}</h1>
      <p>{post.data.content}</p>
      <div className="flex gap-2">
        <button
          onClick={onLike}
          className="cursor-pointer disabled:text-gray-400"
          disabled={post.state === "update"}
        >
          Like
        </button>
        <button className="cursor-pointer" onClick={onEdit}>
          Edit
        </button>
      </div>
      {isEdit && (
        <>
          <textarea
            className="border-2"
            rows={12}
            cols={60}
            value={editContent}
            onChange={onChange}
          />
          <br />
          <div className="flex gap-2">
            <button onClick={() => setIsEdit(false)}>Cancel</button>
            <button onClick={onUpdate}>Update</button>
          </div>
        </>
      )}
    </div>
  );
}

export default Post;
