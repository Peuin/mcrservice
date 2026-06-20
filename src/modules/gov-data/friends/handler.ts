// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../../config/env.js";
import { readHeader, type PortedRequest } from "../../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[friends] background task failed", error));
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};



function mapFriendRows(value: unknown) {
  return arrayValue(value).map((row) => {
    const item = objectValue(row);
    return {
      id: stringValue(item.id),
      username: stringValue(item.username),
      display_name: stringValue(item.display_name),
      avatar_url: stringValue(item.avatar_url),
      friends_since: stringValue(item.friends_since),
    };
  });
}

async function fetchFriendsList(
  supabase: ReturnType<typeof createRequestClient>,
  ownerUserId: string,
  viewerUserId: string,
  limit: number,
) {
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  // Own list: read friendships directly (matches DB rows; avoids stale RPC filters).
  if (ownerUserId === viewerUserId) {
    try {
      return await fetchFriendsListDirect(supabase, ownerUserId, safeLimit);
    } catch (directError) {
      console.warn("friends direct query failed, trying rpc", directError);
    }
  }

  const rpc = ownerUserId === viewerUserId
    ? await supabase.schema("social").rpc("list_friends", { p_limit: safeLimit })
    : await supabase.schema("social").rpc("list_friends_for_user", {
      p_target_user_id: ownerUserId,
      p_limit: safeLimit,
    });
  if (!rpc.error) {
    return mapFriendRows(rpc.data);
  }

  console.warn("friends rpc failed", {
    ownerUserId,
    viewerUserId,
    message: rpc.error.message,
    code: rpc.error.code,
  });

  if (ownerUserId === viewerUserId) {
    return await fetchFriendsListDirect(supabase, ownerUserId, safeLimit);
  }

  throw rpc.error;
}

async function fetchFriendsListDirect(
  supabase: ReturnType<typeof createRequestClient>,
  ownerUserId: string,
  limit: number,
) {
  const { data: rows, error } = await supabase
    .schema("social")
    .from("friendships")
    .select("friend_id, created_at")
    .eq("user_id", ownerUserId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const friendships = arrayValue(rows);
  const friendIds = friendships
    .map((row) => stringValue(objectValue(row).friend_id))
    .filter((id) => isUuid(id));
  if (friendIds.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", friendIds);
  if (profileError) throw profileError;

  const profileById = new Map<string, Json>();
  for (const profile of arrayValue(profiles)) {
    const item = objectValue(profile);
    const id = stringValue(item.id);
    if (id) profileById.set(id, item);
  }

  return friendships.map((row) => {
    const item = objectValue(row);
    const friendId = stringValue(item.friend_id);
    const profile = objectValue(profileById.get(friendId));
    const username = stringValue(profile.username);
    const displayName = stringValue(profile.display_name);
    return {
      id: friendId,
      username,
      display_name: displayName || username || "Bạn ăn ngon",
      avatar_url: stringValue(profile.avatar_url),
      friends_since: stringValue(item.created_at),
    };
  });
}

function mapFriendRequestRows(value: unknown) {
  return arrayValue(value).map((row) => {
    const item = objectValue(row);
    return {
      id: stringValue(item.id),
      requester_id: stringValue(item.requester_id),
      addressee_id: stringValue(item.addressee_id),
      status: stringValue(item.status),
      created_at: stringValue(item.created_at),
      other_user_id: stringValue(item.other_user_id),
      other_username: stringValue(item.other_username),
      other_display_name: stringValue(item.other_display_name),
      other_avatar_url: stringValue(item.other_avatar_url),
    };
  });
}

function createRequestClient(request: PortedRequest) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Thiếu cấu hình SUPABASE_URL hoặc SUPABASE_ANON_KEY.");
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: readHeader(request.headers, "authorization") ?? "" },
    },
  });
}

function createServiceClient() {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Thiếu cấu hình SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function ensureFriendRequestNotification(input: {
  requestId: string;
  recipientId: string;
  actorId: string;
}) {
  const { requestId, recipientId, actorId } = input;
  if (!requestId || !recipientId || !actorId || recipientId === actorId) return;

  const admin = createServiceClient();
  const dedupeKey = `friend_request:${requestId}`;

  const { error: upsertError } = await admin.schema("social").rpc(
    "upsert_notification",
    {
      p_recipient_id: recipientId,
      p_actor_id: actorId,
      p_type: "friend_request",
      p_dedupe_key: dedupeKey,
      p_post_id: null,
      p_comment_id: null,
      p_target_profile_id: actorId,
      p_body_preview: null,
    },
  );
  if (upsertError) {
    console.warn("friend_request notification upsert failed", upsertError);
    return;
  }
}

async function removeFriendshipPairWithService(userId: string, targetUserId: string) {
  const admin = createServiceClient();

  const { error: friendshipError } = await admin
    .schema("social")
    .from("friendships")
    .delete()
    .or(
      `and(user_id.eq.${userId},friend_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_id.eq.${userId})`,
    );
  if (friendshipError) {
    console.error("remove_friendship service friendships delete failed", {
      userId,
      targetUserId,
      message: friendshipError.message,
      details: friendshipError.details,
      hint: friendshipError.hint,
      code: friendshipError.code,
    });
    throw friendshipError;
  }

  const { error: requestError } = await admin
    .schema("social")
    .from("friend_requests")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("status", "pending")
    .or(
      `and(requester_id.eq.${userId},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${userId})`,
    );
  if (requestError) {
    console.error("remove_friendship service friend_requests update failed", {
      userId,
      targetUserId,
      message: requestError.message,
      details: requestError.details,
      hint: requestError.hint,
      code: requestError.code,
    });
    throw requestError;
  }
}

async function requireUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Bạn cần đăng nhập.");
  return data.user;
}

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = stringValue(value).toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return fallback;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function shouldFallbackToServiceDelete(error: unknown) {
  const item = objectValue(error);
  const code = stringValue(item.code);
  const message = stringValue(item.message).toLowerCase();
  return code === "PGRST202" ||
    code === "42883" ||
    code === "42501" ||
    message.includes("could not find the function") ||
    message.includes("schema cache") ||
    message.includes("permission denied");
}

function objectValue(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Json
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function errorCode(error: unknown) {
  const item = objectValue(error);
  const code = stringValue(item.code);
  return code || "FRIENDS_ERROR";
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  const item = objectValue(error);
  const message = stringValue(item.message);
  if (message) return message;
  return "Có lỗi xảy ra với bạn bè.";
}

function errorStatus(error: unknown) {
  const item = objectValue(error);
  const status = numberValue(item.status);
  if (status && status >= 400 && status <= 599) return status;
  return 400;
}

export async function handleFriends(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createRequestClient(request);
    const user = await requireUser(supabase);
    const url = new URL(request.url);

    if (request.method === "GET") {
      const action = stringValue(url.searchParams.get("action")) || "list_friends";
      if (action === "list_requests") {
        const direction = stringValue(url.searchParams.get("direction")) || "incoming";
        const { data, error } = await supabase.schema("social").rpc(
          "list_friend_requests",
          { p_direction: direction },
        );
        if (error) throw error;
        return jsonResponse({
          success: true,
          requests: mapFriendRequestRows(data),
        });
      }

      if (action === "status") {
        const targetUserId = stringValue(url.searchParams.get("targetUserId"));
        const { data, error } = await supabase.schema("social").rpc(
          "friendship_status",
          { p_target_user_id: targetUserId },
        );
        if (error) throw error;
        return jsonResponse({ success: true, ...(objectValue(data)) });
      }

      const targetUserId = stringValue(
        url.searchParams.get("userId") ?? url.searchParams.get("user_id"),
      );
      const limit = numberValue(url.searchParams.get("limit")) ?? 50;
      const ownerUserId = targetUserId && isUuid(targetUserId)
        ? targetUserId
        : user.id;
      const friends = await fetchFriendsList(
        supabase,
        ownerUserId,
        user.id,
        limit,
      );
      console.log("friends list", {
        ownerUserId,
        viewerUserId: user.id,
        count: friends.length,
      });
      return jsonResponse({
        success: true,
        friends,
      });
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({})) as Json;
      const action = stringValue(body.action);

      if (action === "send_request") {
        const targetUserId = stringValue(body.target_user_id ?? body.targetUserId);
        const { data, error } = await supabase.schema("social").rpc(
          "send_friend_request",
          { p_target_user_id: targetUserId },
        );
        if (error) throw error;
        const requestId = stringValue(data);
        await ensureFriendRequestNotification({
          requestId,
          recipientId: targetUserId,
          actorId: user.id,
        });
        return jsonResponse({ success: true, request_id: requestId });
      }

      if (action === "respond_request") {
        const requestId = stringValue(body.request_id ?? body.requestId);
        if (!requestId) {
          return jsonResponse({ error: "Thiếu requestId." }, 400);
        }
        const accept = booleanValue(body.accept, false);
        const { data, error } = await supabase.schema("social").rpc(
          "respond_friend_request",
          { p_request_id: requestId, p_accept: accept },
        );
        if (error) {
          console.error("respond_friend_request failed", {
            requestId,
            accept,
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
          throw error;
        }
        return jsonResponse({ success: true, status: stringValue(data) });
      }

      if (action === "cancel_request") {
        const requestId = stringValue(body.request_id ?? body.requestId);
        const { data, error } = await supabase.schema("social").rpc(
          "cancel_friend_request",
          { p_request_id: requestId },
        );
        if (error) throw error;
        return jsonResponse({ success: true, status: stringValue(data) });
      }

      if (action === "remove_friendship" || action === "unfriend") {
        const targetUserId = stringValue(body.target_user_id ?? body.targetUserId);
        if (!isUuid(targetUserId)) {
          return jsonResponse({ error: "Thiếu targetUserId hợp lệ." }, 400);
        }
        const { data, error } = await supabase.schema("social").rpc(
          "remove_friendship",
          { p_target_user_id: targetUserId },
        );
        if (error) {
          console.error("remove_friendship rpc failed", {
            targetUserId,
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          });
          if (!shouldFallbackToServiceDelete(error)) throw error;
          try {
            await removeFriendshipPairWithService(user.id, targetUserId);
          } catch (fallbackError) {
            console.error("remove_friendship service fallback failed", {
              targetUserId,
              fallbackError,
            });
            throw error;
          }
          return jsonResponse({ success: true, status: "removed" });
        }
        return jsonResponse({ success: true, status: stringValue(data) });
      }

      if (action === "block_user" || action === "block") {
        const targetUserId = stringValue(body.target_user_id ?? body.targetUserId);
        const { data, error } = await supabase.schema("social").rpc(
          "block_user",
          { p_target_user_id: targetUserId },
        );
        if (error) throw error;
        return jsonResponse({ success: true, status: stringValue(data) });
      }

      if (action === "unblock_user" || action === "unblock") {
        const targetUserId = stringValue(body.target_user_id ?? body.targetUserId);
        const { data, error } = await supabase.schema("social").rpc(
          "unblock_user",
          { p_target_user_id: targetUserId },
        );
        if (error) throw error;
        return jsonResponse({ success: true, status: stringValue(data) });
      }

      return jsonResponse({ error: "Action friends không hợp lệ." }, 400);
    }

    return jsonResponse({ error: "friends chỉ hỗ trợ GET hoặc POST." }, 405);
  } catch (error) {
    const traceId = randomUUID();
    console.error("friends error", { traceId, error });
    return jsonResponse({
      error: errorMessage(error),
      code: errorCode(error),
      traceId,
    }, errorStatus(error));
  }

}
