import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { proxyEdgeFunction, type EdgeFunctionResult } from "../../shared/edge-function-proxy.js";
import { placeSearchSchema } from "./schemas.js";
import { searchGoongPlaces } from "./service.js";
import { goongSearchDocs } from "./swagger.js";

function invalid(reply: FastifyReply, details: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu tìm địa điểm không hợp lệ.", details });
}
function send(reply: FastifyReply, result: EdgeFunctionResult) { return reply.code(result.status).send(result.payload); }

export const mapRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/map/places/goong", { schema: goongSearchDocs }, async (request, reply) => {
    const parsed = placeSearchSchema.safeParse(request.query);
    return parsed.success ? send(reply, await searchGoongPlaces(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });

  // Alias tương thích — implementation Goong.
  app.get("/api/v1/map/places/vietmap", { schema: { hide: true } }, async (request, reply) => {
    const parsed = placeSearchSchema.safeParse(request.query);
    return parsed.success ? send(reply, await searchGoongPlaces(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });

  for (const path of ["/goong-place-search", "/search/goong-place-search", "/vietmap-place-search", "/search/vietmap-place-search"]) {
    app.route({
      method: ["GET", "POST"],
      url: path,
      schema: { hide: true },
      handler: (request, reply) =>
        proxyEdgeFunction(request, reply, {
          functionName: "goong-place-search",
          query: asObject(request.query),
          body: request.body,
          method: request.method as "GET" | "POST"
        })
    });
  }
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
