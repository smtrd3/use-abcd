// biome-ignore assist/source/organizeImports: useless
import { useCallback, useState, type ChangeEvent } from "react";
import { useCrud, useItemState, type ItemWithState } from "../useCrud";

interface PostType {
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
			items: [
				{ id: "one", title: "Hello world!", content: "This is my first post" },
			],
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

function Post(props: { post: ItemWithState<PostType> }) {
	const [isEdit, setIsEdit] = useState(false);
	const [editContent, setEditContent] = useState("");
	const [data, { update, state }] = useItemState<PostType>("post", props.post);

	const onLike = useCallback(() => {
		update((draft) => {
			draft.liked = true;
		});
	}, [update]);

	const onChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
		setEditContent(e.target.value);
	}, []);

	const onUpdate = useCallback(() => {
		update((draft) => {
			draft.content = editContent;
		});
		setIsEdit(false);
	}, [update, editContent]);

	const onEdit = useCallback(() => {
		setIsEdit((curr) => !curr);
		setEditContent(data.content);
	}, [data]);

	return (
		<div className="p-2">
			<h1 className="font-bold text-3xl">{data.title}</h1>
			<p>{data.content}</p>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={onLike}
					className="cursor-pointer disabled:text-gray-400"
					disabled={state === "update"}
				>
					Like
				</button>
				<button type="button" className="cursor-pointer" onClick={onEdit}>
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
						<button type="button" onClick={() => setIsEdit(false)}>
							Cancel
						</button>
						<button type="button" onClick={onUpdate}>
							Update
						</button>
					</div>
				</>
			)}
		</div>
	);
}

function PostContainer() {
	const { items, isLoading } = useCrud<PostType>(PostsConfig);
	const post = items.at(0);

	if (isLoading || !post) {
		return <div>Loading.....</div>;
	}

	return <Post post={post} />;
}

export default PostContainer;
