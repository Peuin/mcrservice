import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { proxyEdgeFunction, type EdgeFunctionResult } from "../../shared/edge-function-proxy.js";
import { inboxQuerySchema, notificationParamsSchema, pushTokenSchema, unregisterPushTokenSchema } from "./schemas.js";
import { deleteNotification, listNotifications, markAllNotificationsRead, markNotificationRead, muteNotification, registerPushToken, unregisterPushToken } from "./service.js";
import { deleteNotificationDocs, listNotificationsDocs, markAllReadDocs, markReadDocs, muteNotificationDocs, registerPushTokenDocs, unregisterPushTokenDocs } from "./swagger.js";

function invalid(reply: FastifyReply, details: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu thông báo không hợp lệ.", details });
}
function send(reply: FastifyReply, result: EdgeFunctionResult) { return reply.code(result.status).send(result.payload); }

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/notifications", { schema: listNotificationsDocs }, async (request, reply) => {
    const parsed = inboxQuerySchema.safeParse(request.query);
    return parsed.success ? send(reply, await listNotifications(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.patch("/api/v1/notifications/:notificationId/read", { schema: markReadDocs }, async (request, reply) => {
    const parsed = notificationParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await markNotificationRead(request, parsed.data.notificationId)) : invalid(reply, parsed.error.flatten());
  });
  app.patch("/api/v1/notifications/read-all", { schema: markAllReadDocs }, async (request, reply) => send(reply, await markAllNotificationsRead(request)));
  app.patch("/api/v1/notifications/:notificationId/mute", { schema: muteNotificationDocs }, async (request, reply) => {
    const parsed = notificationParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await muteNotification(request, parsed.data.notificationId)) : invalid(reply, parsed.error.flatten());
  });
  app.delete("/api/v1/notifications/:notificationId", { schema: deleteNotificationDocs }, async (request, reply) => {
    const parsed = notificationParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await deleteNotification(request, parsed.data.notificationId)) : invalid(reply, parsed.error.flatten());
  });
  app.post("/api/v1/notification-devices/push-tokens", { schema: registerPushTokenDocs }, async (request, reply) => {
    const parsed = pushTokenSchema.safeParse(request.body);
    return parsed.success ? send(reply, await registerPushToken(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.delete("/api/v1/notification-devices/push-tokens", { schema: unregisterPushTokenDocs }, async (request, reply) => {
    const parsed = unregisterPushTokenSchema.safeParse(request.body);
    return parsed.success ? send(reply, await unregisterPushToken(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });

  app.route({ method: ["GET", "POST"], url: "/notifications", schema: { hide: true }, handler: (request, reply) =>
    proxyEdgeFunction(request, reply, { functionName: "notifications", query: asObject(request.query), body: request.body,
      method: request.method as "GET" | "POST" }) });
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
