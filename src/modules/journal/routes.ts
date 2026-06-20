import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { proxyEdgeFunction, type EdgeFunctionResult } from "../../shared/edge-function-proxy.js";
import { dayEntriesQuerySchema, monthMarkersQuerySchema } from "./schemas.js";
import { getDayEntries, getMonthMarkers } from "./service.js";
import { dayEntriesDocs, monthMarkersDocs } from "./swagger.js";

function invalid(reply: FastifyReply, details: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu journal không hợp lệ.", details });
}
function send(reply: FastifyReply, result: EdgeFunctionResult) { return reply.code(result.status).send(result.payload); }

export const journalRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/journal/month-markers", { schema: monthMarkersDocs }, async (request, reply) => {
    const parsed = monthMarkersQuerySchema.safeParse(request.query);
    return parsed.success ? send(reply, await getMonthMarkers(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.get("/api/v1/journal/day-entries", { schema: dayEntriesDocs }, async (request, reply) => {
    const parsed = dayEntriesQuerySchema.safeParse(request.query);
    return parsed.success ? send(reply, await getDayEntries(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });

  app.route({ method: ["GET", "POST"], url: "/journal", schema: { hide: true }, handler: (request, reply) =>
    proxyEdgeFunction(request, reply, { functionName: "journal", query: asObject(request.query), body: request.body,
      method: request.method as "GET" | "POST" }) });
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
