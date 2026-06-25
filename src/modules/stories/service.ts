import type { FastifyRequest } from "fastify";
import { callHandler } from "../../shared/handler-dispatch.js";
import type { CreateStoryInput, StoriesQuery } from "./schemas.js";

type StoriesContext = Pick<FastifyRequest, "method" | "headers" | "id">;

export function listVisibleStories(context: StoriesContext, query: StoriesQuery) {
  return callHandler(context, { name: "stories", method: "GET", query });
}

export function listArchivedStories(context: StoriesContext) {
  return callHandler(context, { name: "stories", method: "GET", query: { archive: true } });
}

export function createStory(context: StoriesContext, input: CreateStoryInput) {
  return callHandler(context, { name: "stories", method: "POST", body: input });
}
