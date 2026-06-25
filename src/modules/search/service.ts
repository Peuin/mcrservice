import type { FastifyRequest } from "fastify";
import { callHandler } from "../../shared/handler-dispatch.js";
import type { DiscoverQuery, RecentQuery, SaveRecentInput, SearchPostsQuery } from "./schemas.js";

type SearchContext = Pick<FastifyRequest, "method" | "headers" | "id">;

function callSearch(context: SearchContext, path: string, options: {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, unknown>;
  body?: unknown;
  forwardClientAuth?: boolean;
} = {}) {
  return callHandler(context, {
    name: "app-search",
    path,
    method: options.method ?? "GET",
    query: options.query,
    body: options.body,
    forwardClientAuth: options.forwardClientAuth
  });
}

export function discover(context: SearchContext, query: DiscoverQuery) {
  return callSearch(context, "", { query, forwardClientAuth: false });
}
export function searchPosts(context: SearchContext, query: SearchPostsQuery) {
  return callSearch(context, "posts", { query, forwardClientAuth: false });
}
export function listRecent(context: SearchContext, query: RecentQuery) {
  return callSearch(context, "recent", { query });
}
export function saveRecent(context: SearchContext, input: SaveRecentInput) {
  return callSearch(context, "recent", { method: "POST", body: input });
}
export function deleteRecent(context: SearchContext, id: string) {
  return callSearch(context, `recent/${id}`, { method: "DELETE" });
}
export function clearRecent(context: SearchContext) {
  return callSearch(context, "recent", { method: "DELETE" });
}
