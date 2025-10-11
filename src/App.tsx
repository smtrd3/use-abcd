import { useCallback } from "react";
import PostContainer from "./examples/Post";
import { Todo } from "./examples/Todo";
import "./index.css";
import { Switch, Route, Link } from "wouter";

function App() {
	const active = useCallback((active: boolean) => {
		return active ? "underline" : "";
	}, []);

	return (
		<div>
			<nav className="flex gap-2 p-2">
				<Link className={active} to="/">
					Blog
				</Link>
				<Link className={active} to="/2">
					Todo
				</Link>
			</nav>
			<Switch>
				<Route path="/2" component={Todo} />
				<Route path="/" component={PostContainer} />
			</Switch>
		</div>
	);
}

export default App;
