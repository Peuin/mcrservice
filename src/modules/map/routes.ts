import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { HandlerResult } from "../../shared/handler-dispatch.js";
import { placeSearchSchema } from "./schemas.js";
import { searchGoongPlaces } from "./service.js";
import { goongSearchDocs } from "./swagger.js";

function invalid(reply: FastifyReply, details: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu tìm địa điểm không hợp lệ.", details });
}
function send(reply: FastifyReply, result: HandlerResult) { return reply.code(result.status).send(result.payload); }

export const mapRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/map/places/goong", { schema: goongSearchDocs }, async (request, reply) => {
    const parsed = placeSearchSchema.safeParse(request.query);
    return parsed.success ? send(reply, await searchGoongPlaces(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });

  app.get("/api/v1/map/places/vietmap", { schema: { hide: true } }, async (request, reply) => {
    const parsed = placeSearchSchema.safeParse(request.query);
    return parsed.success ? send(reply, await searchGoongPlaces(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
};
