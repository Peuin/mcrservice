// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[notifications] background task failed", error));
}


const NOTIFICATIONS_CACHE_TTL_SECONDS = 300;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};



function createRequestClient(request: PortedRequest) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: readHeader(request.headers, "authorization") ?? "",
      },
    },
  });
}

async function requireUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Bạn cần đăng nhập để xem thông báo.");
  }
  return data.user;
}

async function cacheNotificationInbox(
  userId: string,
  response: Json,
  options: { limit: number; before: string | null },
) {
  if (!userId) return;
  const now = new Date().toISOString();
  const payload = {
    ...response,
    cachedAt: now,
    userId,
    limit: options.limit,
    before: options.before,
  };
  const cacheKey = buildNotificationInboxCacheKey(userId, options);
  await redisSet(cacheKey, payload, NOTIFICATIONS_CACHE_TTL_SECONDS);
  await redisSet(
    `notifications:last-opened:v1:${userId}`,
    { userId, openedAt: now },
    86400,
  );
}

function buildNotificationInboxCacheKey(
  userId: string,
  options: { limit: number; before: string | null },
) {
  return [
    "notifications:inbox:v1",
    userId,
    `limit:${options.limit}`,
    `before:${options.before ?? "latest"}`,
  ].join(":");
}

async function redisSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  const redisUrl = env.UPSTASH_REDIS_REST_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    console.warn("notifications redis set skipped: missing Upstash config");
    return;
  }

  try {
    await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "SET",
        key,
        JSON.stringify(value),
        "EX",
        String(ttlSeconds),
      ]),
    });
  } catch (error) {
    console.warn("notifications redis set skipped", error);
  }
}

async function registerPushToken(
  supabase: ReturnType<typeof createRequestClient>,
  body: Json,
) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("Bạn cần đăng nhập để bật thông báo.");
  }

  const token = stringValue(body.token).trim();
  if (!token) {
    throw new Error("Missing push token.");
  }

  const platform = normalizePlatform(body.platform);
  const { error } = await supabase.schema("social").from("push_tokens").upsert({
    user_id: authData.user.id,
    token,
    platform,
    device_id: stringValue(body.deviceId ?? body.device_id) || null,
    app_version: stringValue(body.appVersion ?? body.app_version) || null,
    updated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "token" });
  if (error) throw error;
}

async function unregisterPushToken(
  supabase: ReturnType<typeof createRequestClient>,
  body: Json,
) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("Bạn cần đăng nhập để tắt thông báo.");
  }

  const token = stringValue(body.token).trim();
  if (!token) return;

  const { error } = await supabase
    .schema("social")
    .from("push_tokens")
    .delete()
    .eq("user_id", authData.user.id)
    .eq("token", token);
  if (error) throw error;
}

function normalizePlatform(value: unknown) {
  const platform = stringValue(value).trim().toLowerCase();
  if (["android", "ios", "macos", "web"].includes(platform)) {
    return platform;
  }
  return "unknown";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(stringValue(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function publicStorageUrl(
  supabase: ReturnType<typeof createRequestClient>,
  bucket: string,
  path: string,
) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Notifications request failed.";
}

export async function handleNotifications(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createRequestClient(request);
    const url = new URL(request.url);

    if (request.method === "GET") {
      const user = await requireUser(supabase);
      const limit = numberValue(url.searchParams.get("limit")) ?? 30;
      const before = stringValue(url.searchParams.get("before")) || null;
      const { data, error } = await supabase.schema("social").rpc(
        "notification_inbox",
        {
          p_limit: limit,
          p_before: before,
        },
      );
      if (error) throw error;

      const { data: unread, error: unreadError } = await supabase
        .schema("social")
        .rpc("notification_unread_count");
      if (unreadError) throw unreadError;

      const response = {
        notifications: (Array.isArray(data) ? data as Json[] : []).map((row) => ({
          ...row,
          actor_avatar_url: publicStorageUrl(
            supabase,
            "avatars",
            stringValue(row.actor_avatar_url),
          ),
        })),
        unreadCount: Number(unread ?? 0),
      };
      await cacheNotificationInbox(user.id, response, {
        limit,
        before,
      });
      return jsonResponse(response);
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({})) as Json;
      const action = stringValue(body.action).trim();

      if (action === "register_push_token") {
        await registerPushToken(supabase, body);
        return jsonResponse({ ok: true });
      }

      if (action === "unregister_push_token") {
        await unregisterPushToken(supabase, body);
        return jsonResponse({ ok: true });
      }

      if (action === "read_all" || action === "mark_all_read") {
        const { data, error } = await supabase.schema("social").rpc(
          "mark_all_notifications_read",
        );
        if (error) throw error;
        return jsonResponse({ ok: true, updatedCount: Number(data ?? 0) });
      }

      const notificationId = stringValue(body.notificationId ?? body.id).trim();
      if (!notificationId) {
        return jsonResponse({ error: "Missing notificationId." }, 400);
      }

      const rpcName = action === "read"
        ? "mark_notification_read"
        : action === "delete"
        ? "delete_notification"
        : action === "mute"
        ? "mute_notification"
        : "";
      if (!rpcName) {
        return jsonResponse({ error: "Unsupported notification action." }, 400);
      }

      const { error } = await supabase.schema("social").rpc(rpcName, {
        p_notification_id: notificationId,
      });
      if (error) throw error;

      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Not found." }, 404);
  } catch (error) {
    console.error("notifications error", error);
    return jsonResponse({ error: errorMessage(error) }, 400);
  }

}
