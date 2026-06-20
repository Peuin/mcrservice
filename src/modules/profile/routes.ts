import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { proxyEdgeFunction, type EdgeFunctionResult } from "../../shared/edge-function-proxy.js";
import { profileParamsSchema, profileQuerySchema, profileRefreshQuerySchema, updateProfileSchema } from "./schemas.js";
import { getProfile, getProfileById, updateCurrentProfile } from "./service.js";
import { getCurrentProfileDocs, getProfileByIdDocs, updateProfileDocs } from "./swagger.js";

function invalid(reply: FastifyReply, details: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu hồ sơ không hợp lệ.", details });
}
function send(reply: FastifyReply, result: EdgeFunctionResult) { return reply.code(result.status).send(result.payload); }
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

  for (const path of ["/profile", "/user/profile"]) {
    app.route({ method: ["GET", "POST"], url: path, schema: { hide: true }, handler: (request, reply) =>
      proxyEdgeFunction(request, reply, { functionName: "profile", query: asObject(request.query), body: request.body,
        method: request.method as "GET" | "POST" }) });
  }
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
