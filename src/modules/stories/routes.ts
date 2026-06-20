import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { proxyEdgeFunction, type EdgeFunctionResult } from "../../shared/edge-function-proxy.js";
import { createStorySchema, storiesQuerySchema } from "./schemas.js";
import { createStory, listArchivedStories, listVisibleStories } from "./service.js";
import { archiveStoriesDocs, createStoryDocs, listStoriesDocs } from "./swagger.js";

const STORY_BODY_LIMIT_BYTES = 21 * 1024 * 1024;

function invalid(reply: FastifyReply, details: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu story không hợp lệ.", details });
}
function send(reply: FastifyReply, result: EdgeFunctionResult) { return reply.code(result.status).send(result.payload); }

export const storyRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/stories", { schema: listStoriesDocs }, async (request, reply) => {
    const parsed = storiesQuerySchema.safeParse(request.query);
    return parsed.success ? send(reply, await listVisibleStories(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.get("/api/v1/stories/archive", { schema: archiveStoriesDocs }, async (request, reply) =>
    send(reply, await listArchivedStories(request)));
  app.post("/api/v1/stories", { schema: createStoryDocs, bodyLimit: STORY_BODY_LIMIT_BYTES }, async (request, reply) => {
    const parsed = createStorySchema.safeParse(request.body);
    return parsed.success ? send(reply, await createStory(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });

  app.route({ method: ["GET", "POST"], url: "/stories", schema: { hide: true }, bodyLimit: STORY_BODY_LIMIT_BYTES,
    handler: (request, reply) => proxyEdgeFunction(request, reply, { functionName: "stories", query: asObject(request.query),
      body: request.body, method: request.method as "GET" | "POST" }) });
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
