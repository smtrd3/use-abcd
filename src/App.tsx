import "./index.css";
import { useCallback } from "react";
import { Products } from "./examples/Products";
import { PaginatedUsers } from "./examples/PaginatedUsers";
import { OptimisticComments } from "./examples/OptimisticComments";
import { TreeEditor } from "./examples/TreeEditor";
import { Switch, Route, Link } from "wouter";

function App() {
  const active = useCallback((active: boolean) => {
    return active ? "underline font-semibold" : "";
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm mb-6 p-4">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-3 text-gray-800">use-abcd Examples</h1>
          <div className="flex flex-wrap gap-3">
            <Link className={active} to="/">
              <span className="text-blue-600 hover:text-blue-800">Products (Full CRUD)</span>
            </Link>
            <Link className={active} to="/pagination">
              <span className="text-blue-600 hover:text-blue-800">Pagination</span>
            </Link>
            <Link className={active} to="/optimistic">
              <span className="text-blue-600 hover:text-blue-800">Optimistic Updates</span>
            </Link>
            <Link className={active} to="/tree">
              <span className="text-blue-600 hover:text-blue-800">Tree Editor</span>
            </Link>
          </div>
        </div>
      </nav>
      <div className="max-w-6xl mx-auto px-4">
        <Switch>
          <Route path="/" component={Products} />
          <Route path="/pagination" component={PaginatedUsers} />
          <Route path="/optimistic" component={OptimisticComments} />
          <Route path="/tree" component={TreeEditor} />
        </Switch>
      </div>
    </div>
  );
}

export default App;
