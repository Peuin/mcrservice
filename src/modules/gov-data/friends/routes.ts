import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { proxyEdgeFunction, type EdgeFunctionResult } from "../../../shared/edge-function-proxy.js";
import { friendsQuerySchema, requestIdParamsSchema, requestsQuerySchema, respondRequestSchema, userIdParamsSchema } from "./schemas.js";
import { blockUser, cancelFriendRequest, getFriendshipStatus, listFriendRequests, listFriends, removeFriendship, respondFriendRequest, sendFriendRequest, unblockUser } from "./service.js";
import { blockUserDocs, cancelRequestDocs, listFriendsDocs, listRequestsDocs, removeFriendshipDocs, respondRequestDocs, sendRequestDocs, statusDocs, unblockUserDocs } from "./swagger.js";

function invalid(reply: FastifyReply, details: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu bạn bè không hợp lệ.", details });
}
function send(reply: FastifyReply, result: EdgeFunctionResult) { return reply.code(result.status).send(result.payload); }
function issues(...results: Array<{ success: boolean; error?: { flatten(): unknown } }>) {
  return results.find((result) => !result.success)?.error?.flatten() ?? null;
}

export const friendRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/gov-data/friends", { schema: listFriendsDocs }, async (request, reply) => {
    const parsed = friendsQuerySchema.safeParse(request.query);
    return parsed.success ? send(reply, await listFriends(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.get("/api/v1/gov-data/friend-requests", { schema: listRequestsDocs }, async (request, reply) => {
    const parsed = requestsQuerySchema.safeParse(request.query);
    return parsed.success ? send(reply, await listFriendRequests(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.get("/api/v1/gov-data/friendships/:userId/status", { schema: statusDocs }, async (request, reply) => {
    const parsed = userIdParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await getFriendshipStatus(request, parsed.data.userId)) : invalid(reply, parsed.error.flatten());
  });
  app.post("/api/v1/gov-data/users/:userId/friend-requests", { schema: sendRequestDocs }, async (request, reply) => {
    const parsed = userIdParamsSchema.safeParse(request.params);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const result = await sendFriendRequest(request, parsed.data.userId);
    return result.status === 200 ? reply.code(201).send(result.payload) : send(reply, result);
  });
  app.patch("/api/v1/gov-data/friend-requests/:requestId", { schema: respondRequestDocs }, async (request, reply) => {
    const params = requestIdParamsSchema.safeParse(request.params); const body = respondRequestSchema.safeParse(request.body);
    return params.success && body.success ? send(reply, await respondFriendRequest(request, params.data.requestId, body.data)) : invalid(reply, issues(params, body));
  });
  app.delete("/api/v1/gov-data/friend-requests/:requestId", { schema: cancelRequestDocs }, async (request, reply) => {
    const parsed = requestIdParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await cancelFriendRequest(request, parsed.data.requestId)) : invalid(reply, parsed.error.flatten());
  });
  app.delete("/api/v1/gov-data/friendships/:userId", { schema: removeFriendshipDocs }, async (request, reply) => {
    const parsed = userIdParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await removeFriendship(request, parsed.data.userId)) : invalid(reply, parsed.error.flatten());
  });
  app.post("/api/v1/gov-data/blocks/:userId", { schema: blockUserDocs }, async (request, reply) => {
    const parsed = userIdParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await blockUser(request, parsed.data.userId)) : invalid(reply, parsed.error.flatten());
  });
  app.delete("/api/v1/gov-data/blocks/:userId", { schema: unblockUserDocs }, async (request, reply) => {
    const parsed = userIdParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await unblockUser(request, parsed.data.userId)) : invalid(reply, parsed.error.flatten());
  });

  for (const path of ["/friends", "/user/friends"]) {
    app.route({ method: ["GET", "POST"], url: path, schema: { hide: true }, handler: (request, reply) =>
      proxyEdgeFunction(request, reply, { functionName: "friends", query: asObject(request.query), body: request.body,
        method: request.method as "GET" | "POST" }) });
  }
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
