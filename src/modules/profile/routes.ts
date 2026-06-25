import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { HandlerResult } from "../../shared/handler-dispatch.js";
import { profileParamsSchema, profileQuerySchema, profileRefreshQuerySchema, updateProfileSchema } from "./schemas.js";
import { getProfile, getProfileById, syncCurrentUserProfile, updateCurrentProfile } from "./service.js";
import { getCurrentProfileDocs, getProfileByIdDocs, syncProfileDocs, updateProfileDocs } from "./swagger.js";

function invalid(reply: FastifyReply, details: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu hồ sơ không hợp lệ.", details });
}
function send(reply: FastifyReply, result: HandlerResult) { return reply.code(result.status).send(result.payload); }
function issues(...results: Array<{ success: boolean; error?: { flatten(): unknown } }>) {
  return results.find((result) => !result.success)?.error?.flatten() ?? null;
}

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/profiles/me", { schema: getCurrentProfileDocs }, async (request, reply) => {
    const parsed = profileQuerySchema.safeParse(request.query);
    return parsed.success ? send(reply, await getProfile(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.get("/api/v1/profiles/:userId", { schema: getProfileByIdDocs }, async (request, reply) => {
    const params = profileParamsSchema.safeParse(request.params);
    const query = profileRefreshQuerySchema.safeParse(request.query);
    return params.success && query.success
      ? send(reply, await getProfileById(request, params.data.userId, query.data.refresh))
      : invalid(reply, issues(params, query));
  });
  app.patch("/api/v1/profiles/me", { schema: updateProfileDocs }, async (request, reply) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    return parsed.success ? send(reply, await updateCurrentProfile(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.post("/api/v1/profiles/sync", { schema: syncProfileDocs }, async (request, reply) => {
    return send(reply, await syncCurrentUserProfile(request));
  });
};
