// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[profile] background task failed", error));
}


const PROFILE_CACHE_TTL_SECONDS = 60 * 60 * 24;

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
    throw new Error("Thiếu cấu hình SUPABASE_URL hoặc SUPABASE_ANON_KEY.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: readHeader(request.headers, "authorization") ?? "",
      },
    },
  });
}

async function fetchProfile(
  supabase: ReturnType<typeof createRequestClient>,
  url: URL,
) {
  const forceRefresh = url.searchParams.has("refresh");
  const viewer = await getOptionalUser(supabase);
  const userId = stringValue(url.searchParams.get("userId"));
  const username = normalizeUsername(url.searchParams.get("username"));
  const cacheKey = buildProfileCacheKey({
    viewerId: viewer?.id ?? null,
    userId: userId || null,
    username: username || null,
  });

  if (!forceRefresh) {
    const cached = await redisGet(cacheKey);
    if (cached) {
      return await mergeFreshFriendshipFields(supabase, cached, viewer?.id ?? null);
    }
  }

  const targetId = userId || viewer?.id || "";

  let profileQuery = supabase
    .from("profiles")
    .select(
      "id,display_name,username,avatar_url,bio,created_at,podcast_url,show_instagram_badge,show_recent_views,is_private",
    );

  if (username) {
    profileQuery = profileQuery.eq("username", username);
  } else if (targetId) {
    profileQuery = profileQuery.eq("id", targetId);
  } else {
    throw new Error("Thiếu userId hoặc username để tải tường nhà.");
  }

  const { data, error } = await profileQuery.maybeSingle();
  if (error) throw error;
  if (!data && (!viewer || username || targetId !== viewer.id)) {
    throw new Error("Không tìm thấy người dùng này.");
  }

  const profile = data
    ? data as Json
    : {
        id: viewer?.id,
        display_name: profileDisplayName(null, viewer?.user_metadata) ||
          stringValue(viewer?.email) ||
          "Bạn ăn ngon",
        username: "",
        avatar_url: "",
        bio: "",
        created_at: "",
        podcast_url: "",
        show_instagram_badge: true,
        show_recent_views: false,
        is_private: false,
      };
  const profileId = stringValue(profile.id);
  const isCurrentUser = viewer?.id === profileId;
  const isPrivate = booleanValue(profile.is_private);
  const canSeeDetails = isCurrentUser || !isPrivate;

  const postsData = canSeeDetails
    ? await selectMany(
      supabase
        .schema("social")
        .from("posts")
        .select("id,caption,reaction_count,comment_count,created_at")
        .eq("user_id", profileId)
        .order("created_at", { ascending: false })
        .limit(60),
    )
    : [];

  const posts = Array.isArray(postsData) ? postsData as Json[] : [];
  let postCount = 0;
  if (canSeeDetails) {
    const { count, error: postCountError } = await supabase
      .schema("social")
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profileId);
    if (postCountError) {
      console.warn("post_count skipped:", postCountError.message);
      postCount = posts.length;
    } else {
      postCount = Number(count ?? 0) || 0;
    }
  }

  const postIds = ids(posts, "id");
  const mediaRows = postIds.length === 0 ? [] : await selectMany(
    supabase
      .schema("social")
      .from("post_media")
      .select("post_id,url,sort_order,created_at")
      .in("post_id", postIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  );
  const mediaByPostId = firstBy(mediaRows, "post_id");
  const postPreviews = posts.map((post) => {
    const media = mediaByPostId.get(stringValue(post.id));
    return {
      id: stringValue(post.id),
      caption: stringValue(post.caption),
      media_url: publicStorageUrl(supabase, "post-media", stringValue(media?.url)),
      reaction_count: numberValue(post.reaction_count),
      comment_count: numberValue(post.comment_count),
      created_at: stringValue(post.created_at),
    };
  });

  const { data: friendCountData, error: friendCountError } = await supabase
    .schema("social")
    .rpc("friend_count", { p_user_id: profileId });
  if (friendCountError) {
    console.warn("friend_count skipped:", friendCountError.message);
  }

  let storyCount = 0;
  if (isCurrentUser) {
    const { count, error: storyCountError } = await supabase
      .schema("social")
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profileId);
    if (storyCountError) {
      console.warn("story_count skipped:", storyCountError.message);
    } else {
      storyCount = Number(count ?? 0) || 0;
    }
  }

  let friendshipStatus: Json = { status: isCurrentUser ? "self" : "none" };
  if (viewer && !isCurrentUser) {
    const { data: statusData, error: statusError } = await supabase
      .schema("social")
      .rpc("friendship_status", { p_target_user_id: profileId });
    if (statusError) {
      console.warn("friendship_status skipped:", statusError.message);
    } else if (statusData && typeof statusData === "object") {
      friendshipStatus = statusData as Json;
    }
  }

  const response = {
    profile: {
      id: profileId,
      author_name: profileDisplayName(profile, viewer?.user_metadata) ||
        stringValue(viewer?.email) ||
        "Bạn ăn ngon",
      username: stringValue(profile.username),
      bio: stringValue(profile.bio),
      podcast_url: stringValue(profile.podcast_url),
      avatar_url: avatarPublicUrl(supabase, profile, viewer?.user_metadata),
      created_at: stringValue(profile.created_at),
      is_current_user: isCurrentUser,
      show_instagram_badge: booleanValue(profile.show_instagram_badge, true),
      show_recent_views: booleanValue(profile.show_recent_views),
      is_private: isPrivate,
      post_count: postCount,
      reaction_count: posts.reduce((sum, post) => sum + numberValue(post.reaction_count), 0),
      comment_count: posts.reduce((sum, post) => sum + numberValue(post.comment_count), 0),
      friend_count: Number(friendCountData ?? 0) || 0,
      story_count: storyCount,
      friendship_status: stringValue(friendshipStatus.status) || "none",
      friendship_request_id: stringValue(friendshipStatus.request_id),
    },
    posts: postPreviews,
  };

  await redisSet(cacheKey, response, PROFILE_CACHE_TTL_SECONDS);
  return response;
}

async function updateProfile(
  supabase: ReturnType<typeof createRequestClient>,
  request: PortedRequest,
) {
  const { user } = await requireUser(supabase);
  const body = await request.json().catch(() => ({}));
  const email = stringValue(user.email);
  const displayName = stringValue(body.displayName ?? body.display_name);
  const username = normalizeUsername(body.username);
  const bio = stringValue(body.bio);
  const podcastUrl = stringValue(body.podcastUrl ?? body.podcast_url);
  const showInstagramBadge = booleanValue(
    body.showInstagramBadge ?? body.show_instagram_badge,
    true,
  );
  const showRecentViews = booleanValue(body.showRecentViews ?? body.show_recent_views);
  const isPrivate = booleanValue(body.isPrivate ?? body.is_private);

  if (!displayName) {
    throw new Error("Nhập tên hiển thị trước đã nha.");
  }
  if (!username) {
    throw new Error("Nhập username trước đã nha.");
  }
  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    throw new Error(
      "Username chỉ dùng chữ thường, số và dấu _ thôi nha — không có khoảng trắng hay ký tự lạ đâu~",
    );
  }

  const { data, error } = await supabase.from("profiles").upsert({
    id: user.id,
    email,
    display_name: displayName,
    username,
    bio,
    podcast_url: podcastUrl,
    show_instagram_badge: showInstagramBadge,
    show_recent_views: showRecentViews,
    is_private: isPrivate,
  }, { onConflict: "id" }).select(
    "id,display_name,username,avatar_url,bio,created_at,podcast_url,show_instagram_badge,show_recent_views,is_private",
  ).single();
  if (error) {
    const message = stringValue(error.message).toLowerCase();
    if (message.includes("profiles_username_format") || message.includes("username_format")) {
      throw new Error(
        "Username chỉ dùng chữ thường, số và dấu _ thôi nha — không có khoảng trắng hay ký tự lạ đâu~",
      );
    }
    if (message.includes("profiles_username_key") || message.includes("duplicate key")) {
      throw new Error("Username này có người dùng rồi. Thử tên khác xem?");
    }
    throw error;
  }

  const profile = data as Json;
  const response = {
    profile: {
      id: user.id,
      author_name: profileDisplayName(profile, user.user_metadata) || email,
      username: stringValue(profile.username),
      bio: stringValue(profile.bio),
      podcast_url: stringValue(profile.podcast_url),
      avatar_url: avatarPublicUrl(supabase, profile, user.user_metadata),
      created_at: stringValue(profile.created_at),
      is_current_user: true,
      show_instagram_badge: booleanValue(profile.show_instagram_badge, true),
      show_recent_views: booleanValue(profile.show_recent_views),
      is_private: booleanValue(profile.is_private),
    },
  };

  return response;
}

async function requireUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Bạn cần đăng nhập để dùng Hồ sơ.");
  }
  return { user: data.user };
}

async function getOptionalUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }
  return data.user;
}

async function selectMany(query: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data as Json[] : [];
}

function ids(rows: Json[], key: string) {
  return [...new Set(rows.map((row) => stringValue(row[key])).filter(Boolean))];
}

function firstBy(rows: Json[], key: string) {
  const output = new Map<string, Json>();
  for (const row of rows) {
    const id = stringValue(row[key]);
    if (id && !output.has(id)) {
      output.set(id, row);
    }
  }
  return output;
}

function profileDisplayName(profile?: Json | null, metadata?: Json | null) {
  return (
    stringValue(profile?.display_name) ||
    stringValue(profile?.full_name) ||
    stringValue(profile?.name) ||
    stringValue(profile?.username) ||
    stringValue(metadata?.display_name) ||
    stringValue(metadata?.full_name) ||
    stringValue(metadata?.name) ||
    stringValue(metadata?.user_name) ||
    stringValue(metadata?.username)
  );
}

function avatarPublicUrl(
  supabase: ReturnType<typeof createRequestClient>,
  profile?: Json | null,
  metadata?: Json | null,
) {
  const rawAvatar =
    stringValue(profile?.avatar_url) ||
    stringValue(profile?.avatar_path) ||
    stringValue(profile?.profile_avatar_url) ||
    stringValue(metadata?.avatar_url) ||
    stringValue(metadata?.picture) ||
    stringValue(metadata?.profile_avatar_url);

  return publicStorageUrl(supabase, "avata", rawAvatar);
}

function publicStorageUrl(
  supabase: ReturnType<typeof createRequestClient>,
  bucket: string,
  path: string,
) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return supabase.storage.from(bucket).getPublicUrl(cleanPath).data.publicUrl;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

function normalizeUsername(value: unknown) {
  return stringValue(value).replace(/^@+/, "").trim().toLowerCase();
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const parsed = Number(stringValue(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = stringValue(value).toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return fallback;
}

function jsonResponse(body: Json, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function mergeFreshFriendshipFields(
  supabase: ReturnType<typeof createRequestClient>,
  cached: Json,
  viewerId: string | null,
) {
  const profile = cached.profile;
  if (!profile || typeof profile !== "object" || !viewerId) {
    return cached;
  }

  const profileId = stringValue((profile as Json).id);
  const isCurrentUser = booleanValue((profile as Json).is_current_user);
  if (!profileId || isCurrentUser || profileId === viewerId) {
    return cached;
  }

  const { data: statusData, error: statusError } = await supabase
    .schema("social")
    .rpc("friendship_status", { p_target_user_id: profileId });
  if (statusError || !statusData || typeof statusData !== "object") {
    return cached;
  }

  const friendshipStatus = statusData as Json;
  return {
    ...cached,
    profile: {
      ...(profile as Json),
      friendship_status: stringValue(friendshipStatus.status) || "none",
      friendship_request_id: stringValue(friendshipStatus.request_id),
    },
  };
}

function buildProfileCacheKey(options: {
  viewerId: string | null;
  userId: string | null;
  username: string | null;
}): string {
  return [
    "profile",
    `viewer:${options.viewerId ?? "anonymous"}`,
    `userId:${options.userId ?? ""}`,
    `username:${options.username ?? ""}`,
  ].join(":");
}

async function redisGet(key: string): Promise<Json | null> {
  const redisUrl = env.UPSTASH_REDIS_REST_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    return null;
  }

  try {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["GET", key]),
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const result = payload?.result;
    return typeof result === "string" ? JSON.parse(result) as Json : null;
  } catch (error) {
    console.warn("profile redis get skipped", error);
    return null;
  }
}

async function redisSet(
  key: string,
  value: Json,
  ttlSeconds: number,
): Promise<void> {
  const redisUrl = env.UPSTASH_REDIS_REST_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
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
        ttlSeconds,
      ]),
    });
  } catch (error) {
    console.warn("profile redis set skipped", error);
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return stringValue((error as { message?: unknown }).message);
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "Có lỗi xảy ra khi xử lý Hồ sơ.";
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error as Json;
}

export async function handleProfile(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createRequestClient(request);
    const url = new URL(request.url);

    if (request.method === "GET") {
      return jsonResponse(await fetchProfile(supabase, url), 200);
    }

    if (request.method === "POST") {
      return jsonResponse(await updateProfile(supabase, request), 200);
    }

    return jsonResponse({ error: "Không tìm thấy endpoint profile." }, 404);
  } catch (error) {
    console.error("profile error", error);
    return jsonResponse({ error: errorMessage(error), details: errorDetails(error) }, 400);
  }

}
