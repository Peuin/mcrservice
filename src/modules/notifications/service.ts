import type { FastifyRequest } from "fastify";
import { callEdgeFunction } from "../../shared/edge-function-proxy.js";
import type { InboxQuery, PushTokenInput, UnregisterPushTokenInput } from "./schemas.js";

type NotificationContext = Pick<FastifyRequest, "method" | "headers" | "id">;

function callNotifications(context: NotificationContext, options: { method?: "GET" | "POST"; query?: Record<string, unknown>; body?: unknown } = {}) {
  return callEdgeFunction(context, { functionName: "notifications", method: options.method ?? "GET", query: options.query, body: options.body });
}

export function listNotifications(context: NotificationContext, query: InboxQuery) {
  return callNotifications(context, { query });
}
export function markNotificationRead(context: NotificationContext, notificationId: string) {
  return callNotifications(context, { method: "POST", body: { action: "read", notificationId } });
}
export function markAllNotificationsRead(context: NotificationContext) {
  return callNotifications(context, { method: "POST", body: { action: "mark_all_read" } });
}
export function muteNotification(context: NotificationContext, notificationId: string) {
  return callNotifications(context, { method: "POST", body: { action: "mute", notificationId } });
}
export function deleteNotification(context: NotificationContext, notificationId: string) {
  return callNotifications(context, { method: "POST", body: { action: "delete", notificationId } });
}
export function registerPushToken(context: NotificationContext, input: PushTokenInput) {
  return callNotifications(context, { method: "POST", body: { action: "register_push_token", ...input } });
}
export function unregisterPushToken(context: NotificationContext, input: UnregisterPushTokenInput) {
  return callNotifications(context, { method: "POST", body: { action: "unregister_push_token", ...input } });
}
