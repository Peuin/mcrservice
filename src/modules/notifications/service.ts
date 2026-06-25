import type { FastifyRequest } from "fastify";
import { localizeApiPayload } from "../../shared/api-i18n.js";
import type { ApiResult } from "../../shared/api-result.js";
import { errorMessage, stringValue } from "../../shared/helpers.js";
import { redisSet } from "../../shared/redis.js";
import { publicStorageUrl } from "../../shared/storage.js";
import { createUserSupabaseClient, requireUser } from "../../shared/supabase-user.js";
import type { InboxQuery, PushTokenInput, UnregisterPushTokenInput } from "./schemas.js";

type Json = Record<string, unknown>;
type NotificationContext = Pick<FastifyRequest, "headers" | "id">;

const NOTIFICATIONS_CACHE_TTL_SECONDS = 300;

function wrap(context: NotificationContext, status: number, payload: unknown): ApiResult {
  return {
    status,
    payload: localizeApiPayload(context, status, payload, { functionName: "notifications" })
  };
}

function clientFrom(context: NotificationContext) {
  return createUserSupabaseClient(context.headers.authorization);
}

function buildNotificationInboxCacheKey(userId: string, options: { limit: number; before: string | null | undefined }) {
  return [
    "notifications:inbox:v1",
    userId,
    `limit:${options.limit}`,
    `before:${options.before ?? "latest"}`
  ].join(":");
}

async function cacheNotificationInbox(
  userId: string,
  response: Json,
  options: { limit: number; before: string | null | undefined }
) {
  if (!userId) return;
  const now = new Date().toISOString();
  const payload = {
    ...response,
    cachedAt: now,
    userId,
    limit: options.limit,
    before: options.before ?? null
  };
  await redisSet(buildNotificationInboxCacheKey(userId, options), payload, NOTIFICATIONS_CACHE_TTL_SECONDS);
  await redisSet(`notifications:last-opened:v1:${userId}`, { userId, openedAt: now }, 86400);
}

function normalizePlatform(value: unknown): PushTokenInput["platform"] {
  const platform = stringValue(value).trim().toLowerCase();
  if (platform === "android" || platform === "ios" || platform === "macos" || platform === "web") {
    return platform;
  }
  return "android";
}

export async function listNotifications(context: NotificationContext, query: InboxQuery): Promise<ApiResult> {
  try {
    const supabase = clientFrom(context);
    const user = await requireUser(supabase, "Bạn cần đăng nhập để xem thông báo.");
    const { data, error } = await supabase.schema("social").rpc("notification_inbox", {
      p_limit: query.limit,
      p_before: query.before ?? null
    });
    if (error) throw error;

    const { data: unread, error: unreadError } = await supabase.schema("social").rpc("notification_unread_count");
    if (unreadError) throw unreadError;

    const response = {
      notifications: (Array.isArray(data) ? (data as Json[]) : []).map((row) => ({
        ...row,
        actor_avatar_url: publicStorageUrl(supabase, "avatars", stringValue(row.actor_avatar_url))
      })),
      unreadCount: Number(unread ?? 0)
    };
    await cacheNotificationInbox(user.id, response, { limit: query.limit, before: query.before });
    return wrap(context, 200, response);
  } catch (error) {
    return wrap(context, 400, { error: errorMessage(error, "Notifications request failed.") });
  }
}

export async function markNotificationRead(context: NotificationContext, notificationId: string): Promise<ApiResult> {
  return mutateNotification(context, "mark_notification_read", notificationId);
}

export async function markAllNotificationsRead(context: NotificationContext): Promise<ApiResult> {
  try {
    const supabase = clientFrom(context);
    await requireUser(supabase, "Bạn cần đăng nhập để xem thông báo.");
    const { data, error } = await supabase.schema("social").rpc("mark_all_notifications_read");
    if (error) throw error;
    return wrap(context, 200, { ok: true, updatedCount: Number(data ?? 0) });
  } catch (error) {
    return wrap(context, 400, { error: errorMessage(error, "Notifications request failed.") });
  }
}

export async function muteNotification(context: NotificationContext, notificationId: string): Promise<ApiResult> {
  return mutateNotification(context, "mute_notification", notificationId);
}

export async function deleteNotification(context: NotificationContext, notificationId: string): Promise<ApiResult> {
  return mutateNotification(context, "delete_notification", notificationId);
}

async function mutateNotification(
  context: NotificationContext,
  rpcName: "mark_notification_read" | "delete_notification" | "mute_notification",
  notificationId: string
): Promise<ApiResult> {
  try {
    const supabase = clientFrom(context);
    await requireUser(supabase, "Bạn cần đăng nhập để xem thông báo.");
    const { error } = await supabase.schema("social").rpc(rpcName, { p_notification_id: notificationId });
    if (error) throw error;
    return wrap(context, 200, { ok: true });
  } catch (error) {
    return wrap(context, 400, { error: errorMessage(error, "Notifications request failed.") });
  }
}

export async function registerPushToken(context: NotificationContext, input: PushTokenInput): Promise<ApiResult> {
  try {
    const supabase = clientFrom(context);
    const user = await requireUser(supabase, "Bạn cần đăng nhập để bật thông báo.");
    const { error } = await supabase.schema("social").from("push_tokens").upsert(
      {
        user_id: user.id,
        token: input.token,
        platform: input.platform,
        device_id: input.deviceId ?? null,
        app_version: input.appVersion ?? null,
        updated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "token" }
    );
    if (error) throw error;
    return wrap(context, 200, { ok: true });
  } catch (error) {
    return wrap(context, 400, { error: errorMessage(error, "Notifications request failed.") });
  }
}

export async function unregisterPushToken(context: NotificationContext, input: UnregisterPushTokenInput): Promise<ApiResult> {
  try {
    const supabase = clientFrom(context);
    const user = await requireUser(supabase, "Bạn cần đăng nhập để tắt thông báo.");
    const { error } = await supabase
      .schema("social")
      .from("push_tokens")
      .delete()
      .eq("user_id", user.id)
      .eq("token", input.token);
    if (error) throw error;
    return wrap(context, 200, { ok: true });
  } catch (error) {
    return wrap(context, 400, { error: errorMessage(error, "Notifications request failed.") });
  }
}
