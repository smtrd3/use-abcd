// biome-ignore assist/source/organizeImports: useless
import { useCallback, useState, type ChangeEvent } from "react";
import {
  useCrud,
  useItemState,
  type CrudConfig,
  type ItemWithState,
  type TransitionStates,
} from "../useCrud";

interface PostType {
  userId: string;
  id: string;
  title: string;
  body: string;
  liked?: boolean;
}

const PostsConfig: CrudConfig<PostType> = {
  id: "post",
  context: {},
  fetch: async () => {
    return fetch("https://jsonplaceholder.typicode.com/posts/1")
      .then((r) => r.json())
      .then((post) => {
        return {
          items: [post],
          metadata: {},
        };
      });
  },
  update: async (item, { signal }) => {
    return fetch("https://jsonplaceholder.typicode.com/posts/1", {
      method: "PATCH",
      body: JSON.stringify({
        body: item.body || "-",
      }),
      headers: {
        "Content-type": "application/json; charset=UTF-8",
      },
      signal,
    }).then(() => ({
      id: item.id,
    }));
  },
};

function Post(props: { post: ItemWithState<PostType, TransitionStates> }) {
  const [isEdit, setIsEdit] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [data, { update, states }] = useItemState<PostType>("post", props.post);

  const onLike = useCallback(() => {
    update(
      (draft) => {
        draft.liked = true;
      },
      { tag: "like" },
    );
  }, [update]);

  const onChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setEditContent(e.target.value);
  }, []);

  const onUpdate = useCallback(() => {
    update((draft) => {
      draft.body = editContent;
    });
    setIsEdit(false);
  }, [update, editContent]);

  const onEdit = useCallback(() => {
    setIsEdit((curr) => !curr);
    setEditContent(data.body);
  }, [data]);

  console.log(states);

  return (
    <div className="p-2">
      <h1 className="font-bold text-3xl mb-2">{data.title}</h1>
      <p>{data.body}</p>
      <p className="font-bold">{data.liked ? "Liked by you" : ""}</p>
      <br />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onLike}
          className="cursor-pointer disabled:text-gray-400"
          disabled={states.has("update:like")}
        >
          Like
        </button>
        <button
          type="button"
          className="cursor-pointer disabled:text-gray-400"
          onClick={onEdit}
          disabled={states.has("update")}
        >
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
            <button type="button" onClick={() => setIsEdit(false)} className="cursor-pointer">
              Cancel
            </button>
            <button
              type="button"
              onClick={onUpdate}
              disabled={states.has("update")}
              className="cursor-pointer"
            >
              Update
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PostContainer() {
  const {
    items,
    fetchState: { isLoading },
  } = useCrud<PostType>(PostsConfig);
  const post = items.at(0);

  if (isLoading || !post) {
    return <div>Loading.....</div>;
  }

  return <Post post={post} />;
}

export default PostContainer;
