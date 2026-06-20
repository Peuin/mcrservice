// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[notification-push] background task failed", error));
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};



function createServiceClient() {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function loadNotification(
  supabase: ReturnType<typeof createServiceClient>,
  notificationId: string,
) {
  const { data, error } = await supabase
    .schema("social")
    .from("notifications")
    .select(
      "id,recipient_id,actor_id,type,post_id,comment_id,target_profile_id,body_preview,deleted_at",
    )
    .eq("id", notificationId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.deleted_at) return null;

  const notification = data as Json;
  const actorId = stringValue(notification.actor_id);
  if (!actorId) return notification;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name,username")
    .eq("id", actorId)
    .maybeSingle();

  return {
    ...notification,
    actor_name: profileDisplayName(profile as Json | null),
  };
}

async function loadPushTokens(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
) {
  if (!userId) return [] as string[];
  const { data, error } = await supabase
    .schema("social")
    .from("push_tokens")
    .select("token")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;

  return [...new Set((data as Json[] | null ?? []).map((row) => stringValue(row.token)).filter(Boolean))];
}

function buildPushMessage(notification: Json) {
  const actorName = stringValue(notification.actor_name) || "Peuin";
  const type = stringValue(notification.type);
  const body = pushBody(type, notification);
  const title = actorName;
  return {
    notification: {
      title,
      body,
    },
    data: {
      notificationId: stringValue(notification.id),
      type,
      postId: stringValue(notification.post_id),
      commentId: stringValue(notification.comment_id),
      targetProfileId: stringValue(notification.target_profile_id),
      actorId: stringValue(notification.actor_id),
    },
    apns: {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "alert",
      },
      payload: {
        aps: {
          alert: {
            title,
            body,
          },
          sound: "default",
          badge: 1,
        },
      },
    },
    android: {
      priority: "high",
      notification: {
        sound: "default",
        channel_id: "peuin_notifications",
      },
    },
  };
}

function pushBody(type: string, notification: Json) {
  const preview = stringValue(notification.body_preview);
  switch (type) {
    case "post_liked":
      return "đã thích bài viết của bạn";
    case "post_commented":
      return preview ? `đã bình luận: ${preview}` : "đã bình luận về bài viết của bạn";
    case "comment_replied":
      return preview ? `đã trả lời: ${preview}` : "đã trả lời bình luận của bạn";
    case "comment_liked":
      return "đã react bình luận của bạn";
    case "user_followed":
      return "đã kết bạn với bạn";
    case "friend_request":
      return "đã gửi lời mời kết bạn";
    default:
      return "Bạn có thông báo mới";
  }
}

async function sendFcmMessage(
  projectId: string,
  accessToken: string,
  token: string,
  message: Json,
) {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          ...message,
        },
      }),
    },
  );

  if (response.ok) return { ok: true };

  const text = await response.text().catch(() => "");
  console.warn("fcm send failed", response.status, text);
  return { ok: false };
}

async function fcmAccessToken() {
  const serviceAccount = fcmServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt({
    iss: stringValue(serviceAccount.client_email),
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }, stringValue(serviceAccount.private_key));

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const payload = await response.json().catch(() => ({})) as Json;
  if (!response.ok) {
    throw new Error(`Không lấy được FCM access token: ${JSON.stringify(payload)}`);
  }
  return stringValue(payload.access_token);
}

function fcmServiceAccount() {
  const raw = env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("Missing FCM_SERVICE_ACCOUNT_JSON.");
  }
  return JSON.parse(raw) as Json;
}

function fcmProjectId() {
  return stringValue(env.FCM_PROJECT_ID) ||
    stringValue(fcmServiceAccount().project_id);
}

async function signJwt(payload: Json, privateKeyPem: string) {
  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(signature)}`;
}

async function importPrivateKey(pem: string) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function assertAuthorized(request: PortedRequest) {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Unauthorized notification push request");
  }

  const authorization = readHeader(request.headers, "authorization") ?? "";
  if (authorization === `Bearer ${serviceRoleKey}`) return;

  const pushSecret = env.NOTIFICATION_PUSH_SECRET;
  const providedSecret = readHeader(request.headers, "x-push-secret") ?? "";
  if (pushSecret && providedSecret === pushSecret) return;

  throw new Error("Unauthorized notification push request");
}

function profileDisplayName(profile?: Json | null) {
  return (
    stringValue(profile?.display_name) ||
    stringValue(profile?.username) ||
    "Peuin"
  );
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

function base64Url(value: string | ArrayBuffer) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringValue(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Notification push failed.";
}

export async function handleNotificationPush(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    assertAuthorized(request);

    const body = await request.json().catch(() => ({})) as Json;
    const notificationId = stringValue(body.notificationId ?? body.notification_id);
    if (!notificationId) {
      return jsonResponse({ error: "Missing notificationId." }, 400);
    }

    const supabase = createServiceClient();
    const notification = await loadNotification(supabase, notificationId);
    if (!notification) {
      return jsonResponse({ ok: true, skipped: "notification_not_found" });
    }

    const tokens = await loadPushTokens(supabase, stringValue(notification.recipient_id));
    if (tokens.length === 0) {
      return jsonResponse({ ok: true, sent: 0, skipped: "no_tokens" });
    }

    const accessToken = await fcmAccessToken();
    const projectId = fcmProjectId();
    const message = buildPushMessage(notification);
    let sent = 0;
    const failedTokens: string[] = [];

    for (const token of tokens) {
      const result = await sendFcmMessage(projectId, accessToken, token, message);
      if (result.ok) {
        sent += 1;
      } else {
        failedTokens.push(token);
      }
    }

    if (failedTokens.length > 0) {
      await supabase.schema("social").from("push_tokens").delete().in("token", failedTokens);
    }

    return jsonResponse({
      ok: true,
      sent,
      failed: failedTokens.length,
    });
  } catch (error) {
    console.error("notification-push error", error);
    const message = errorMessage(error);
    const status = message.toLowerCase().includes("unauthorized") ? 401 : 500;
    return jsonResponse({ error: message }, status);
  }

}
