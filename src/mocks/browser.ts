import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

// Set up the service worker with all handlers
export const worker = setupWorker(...handlers);
