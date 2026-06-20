import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { proxyEdgeFunction, type EdgeFunctionResult } from "../../shared/edge-function-proxy.js";
import { discoverQuerySchema, recentParamsSchema, recentQuerySchema, saveRecentSchema, searchPostsQuerySchema } from "./schemas.js";
import { clearRecent, deleteRecent, discover, listRecent, saveRecent, searchPosts } from "./service.js";
import { clearRecentDocs, deleteRecentDocs, discoverDocs, listRecentDocs, saveRecentDocs, searchPostsDocs } from "./swagger.js";

function invalid(reply: FastifyReply, details: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu tìm kiếm không hợp lệ.", details });
}
function send(reply: FastifyReply, result: EdgeFunctionResult) {
  return reply.code(result.status).send(result.payload);
}

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/search", { schema: discoverDocs }, async (request, reply) => {
    const parsed = discoverQuerySchema.safeParse(request.query);
    return parsed.success ? send(reply, await discover(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.get("/api/v1/search/posts", { schema: searchPostsDocs }, async (request, reply) => {
    const parsed = searchPostsQuerySchema.safeParse(request.query);
    return parsed.success ? send(reply, await searchPosts(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.get("/api/v1/search/recent", { schema: listRecentDocs }, async (request, reply) => {
    const parsed = recentQuerySchema.safeParse(request.query);
    return parsed.success ? send(reply, await listRecent(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.post("/api/v1/search/recent", { schema: saveRecentDocs }, async (request, reply) => {
    const parsed = saveRecentSchema.safeParse(request.body);
    return parsed.success ? send(reply, await saveRecent(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.delete("/api/v1/search/recent/:id", { schema: deleteRecentDocs }, async (request, reply) => {
    const parsed = recentParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await deleteRecent(request, parsed.data.id)) : invalid(reply, parsed.error.flatten());
  });
  app.delete("/api/v1/search/recent", { schema: clearRecentDocs }, async (request, reply) => send(reply, await clearRecent(request)));

  for (const path of ["/app-search", "/app-search/*", "/search/app-search", "/search/app-search/*"]) {
    app.route({ method: ["GET", "POST", "DELETE"], url: path, schema: { hide: true }, handler: (request, reply) => {
      const suffix = request.url.split("?")[0]?.split("/app-search/")[1] ?? "";
      return proxyEdgeFunction(request, reply, { functionName: "app-search", functionPath: suffix,
        query: asObject(request.query), body: request.body, method: request.method as "GET" | "POST" | "DELETE" });
    }});
  }
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
