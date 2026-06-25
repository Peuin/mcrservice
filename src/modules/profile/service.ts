import type { FastifyRequest } from "fastify";
import { localizeApiPayload } from "../../shared/api-i18n.js";
import type { ApiResult } from "../../shared/api-result.js";
import { errorMessage, stringValue } from "../../shared/helpers.js";
import { redisGet, redisSet } from "../../shared/redis.js";
import { avatarPublicUrl, publicStorageUrl } from "../../shared/storage.js";
import { requireUserFromAuthorization, resolveViewer } from "../../shared/supabase-user.js";
import type { ProfileQuery, UpdateProfileInput } from "./schemas.js";

type Json = Record<string, unknown>;
type ProfileContext = Pick<FastifyRequest, "headers" | "id">;

const PROFILE_CACHE_TTL_SECONDS = 60 * 60 * 24;

function wrap(context: ProfileContext, status: number, payload: unknown): ApiResult {
  return {
    status,
    payload: localizeApiPayload(context, status, payload, { functionName: "profile" })
  };
}

function normalizeUsername(value: unknown) {
  return stringValue(value).replace(/^@+/, "").trim().toLowerCase();
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
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

function avatarFromProfile(
  supabase: Parameters<typeof avatarPublicUrl>[0],
  profile?: Json | null,
  metadata?: Json | null
) {
  const rawAvatar =
    stringValue(profile?.avatar_url) ||
    stringValue(profile?.avatar_path) ||
    stringValue(profile?.profile_avatar_url) ||
    stringValue(metadata?.avatar_url) ||
    stringValue(metadata?.picture) ||
    stringValue(metadata?.profile_avatar_url);

  return avatarPublicUrl(supabase, rawAvatar);
}

function buildProfileCacheKey(options: {
  viewerId: string | null;
  userId: string | null;
  username: string | null;
}) {
  return [
    "profile",
    `viewer:${options.viewerId ?? "anonymous"}`,
    `userId:${options.userId ?? ""}`,
    `username:${options.username ?? ""}`
  ].join(":");
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
    if (id && !output.has(id)) output.set(id, row);
  }
  return output;
}

async function mergeFreshFriendshipFields(
  supabase: Awaited<ReturnType<typeof resolveViewer>>["client"],
  cached: Json,
  viewerId: string | null
) {
  const profile = cached.profile;
  if (!profile || typeof profile !== "object" || !viewerId) return cached;

  const profileId = stringValue((profile as Json).id);
  const isCurrentUser = booleanValue((profile as Json).is_current_user);
  if (!profileId || isCurrentUser || profileId === viewerId) return cached;

  const { data: statusData, error: statusError } = await supabase
    .schema("social")
    .rpc("friendship_status", { p_target_user_id: profileId });
  if (statusError || !statusData || typeof statusData !== "object") return cached;

  const friendshipStatus = statusData as Json;
  return {
    ...cached,
    profile: {
      ...(profile as Json),
      friendship_status: stringValue(friendshipStatus.status) || "none",
      friendship_request_id: stringValue(friendshipStatus.request_id)
    }
  };
}

async function fetchProfilePage(
  context: ProfileContext,
  query: ProfileQuery
): Promise<ApiResult> {
  try {
    const { client: supabase, user: viewer } = await resolveViewer(context.headers.authorization);
    const userId = stringValue(query.userId);
    const username = normalizeUsername(query.username);
    const forceRefresh = query.refresh !== undefined;
    const cacheKey = buildProfileCacheKey({
      viewerId: viewer?.id ?? null,
      userId: userId || null,
      username: username || null
    });

    if (!forceRefresh) {
      const cached = await redisGet<Json>(cacheKey);
      if (cached) {
        return wrap(context, 200, await mergeFreshFriendshipFields(supabase, cached, viewer?.id ?? null));
      }
    }

    const targetId = userId || viewer?.id || "";
    let profileQuery = supabase
      .from("profiles")
      .select("id,display_name,username,avatar_url,bio,created_at,podcast_url,show_instagram_badge,show_recent_views,is_private");

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
          display_name: profileDisplayName(null, viewer?.user_metadata) || stringValue(viewer?.email) || "Bạn ăn ngon",
          username: "",
          avatar_url: "",
          bio: "",
          created_at: "",
          podcast_url: "",
          show_instagram_badge: true,
          show_recent_views: false,
          is_private: false
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
            .limit(60)
        )
      : [];

    let postCount = 0;
    if (canSeeDetails) {
      const { count, error: postCountError } = await supabase
        .schema("social")
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profileId);
      if (postCountError) {
        console.warn("post_count skipped:", postCountError.message);
        postCount = postsData.length;
      } else {
        postCount = Number(count ?? 0) || 0;
      }
    }

    const postIds = ids(postsData, "id");
    const mediaRows = postIds.length === 0
      ? []
      : await selectMany(
          supabase
            .schema("social")
            .from("post_media")
            .select("post_id,url,sort_order,created_at")
            .in("post_id", postIds)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true })
        );
    const mediaByPostId = firstBy(mediaRows, "post_id");
    const postPreviews = postsData.map((post) => {
      const media = mediaByPostId.get(stringValue(post.id));
      return {
        id: stringValue(post.id),
        caption: stringValue(post.caption),
        media_url: publicStorageUrl(supabase, "post-media", stringValue(media?.url)),
        reaction_count: numberValue(post.reaction_count),
        comment_count: numberValue(post.comment_count),
        created_at: stringValue(post.created_at)
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
        author_name: profileDisplayName(profile, viewer?.user_metadata) || stringValue(viewer?.email) || "Bạn ăn ngon",
        username: stringValue(profile.username),
        bio: stringValue(profile.bio),
        podcast_url: stringValue(profile.podcast_url),
        avatar_url: avatarFromProfile(supabase, profile, viewer?.user_metadata),
        created_at: stringValue(profile.created_at),
        is_current_user: isCurrentUser,
        show_instagram_badge: booleanValue(profile.show_instagram_badge, true),
        show_recent_views: booleanValue(profile.show_recent_views),
        is_private: isPrivate,
        post_count: postCount,
        reaction_count: postsData.reduce((sum, post) => sum + numberValue(post.reaction_count), 0),
        comment_count: postsData.reduce((sum, post) => sum + numberValue(post.comment_count), 0),
        friend_count: Number(friendCountData ?? 0) || 0,
        story_count: storyCount,
        friendship_status: stringValue(friendshipStatus.status) || "none",
        friendship_request_id: stringValue(friendshipStatus.request_id)
      },
      posts: postPreviews
    };

    await redisSet(cacheKey, response, PROFILE_CACHE_TTL_SECONDS);
    return wrap(context, 200, response);
  } catch (error) {
    console.error("profile fetch error", error);
    return wrap(context, 400, { error: errorMessage(error, "Có lỗi xảy ra khi xử lý Hồ sơ.") });
  }
}

export function getProfile(context: ProfileContext, query: ProfileQuery) {
  return fetchProfilePage(context, query);
}

export function getProfileById(context: ProfileContext, userId: string, refresh?: string | number | boolean) {
  return fetchProfilePage(context, {
    userId,
    ...(refresh === undefined ? {} : { refresh })
  });
}

export async function updateCurrentProfile(
  context: ProfileContext,
  input: UpdateProfileInput
): Promise<ApiResult> {
  try {
    const { client: supabase, user } = await requireUserFromAuthorization(
      context.headers.authorization,
      "Bạn cần đăng nhập để dùng Hồ sơ."
    );

    const email = stringValue(user.email);
    const { data, error } = await supabase.from("profiles").upsert({
      id: user.id,
      email,
      display_name: input.displayName,
      username: input.username,
      bio: input.bio,
      podcast_url: input.podcastUrl,
      show_instagram_badge: input.showInstagramBadge,
      show_recent_views: input.showRecentViews,
      is_private: input.isPrivate
    }, { onConflict: "id" }).select(
      "id,display_name,username,avatar_url,bio,created_at,podcast_url,show_instagram_badge,show_recent_views,is_private"
    ).single();

    if (error) {
      const message = stringValue(error.message).toLowerCase();
      if (message.includes("profiles_username_format") || message.includes("username_format")) {
        throw new Error("Username chỉ dùng chữ thường, số và dấu _ thôi nha — không có khoảng trắng hay ký tự lạ đâu~");
      }
      if (message.includes("profiles_username_key") || message.includes("duplicate key")) {
        throw new Error("Username này có người dùng rồi. Thử tên khác xem?");
      }
      throw error;
    }

    const profile = data as Json;
    return wrap(context, 200, {
      profile: {
        id: user.id,
        author_name: profileDisplayName(profile, user.user_metadata) || email,
        username: stringValue(profile.username),
        bio: stringValue(profile.bio),
        podcast_url: stringValue(profile.podcast_url),
        avatar_url: avatarFromProfile(supabase, profile, user.user_metadata),
        created_at: stringValue(profile.created_at),
        is_current_user: true,
        show_instagram_badge: booleanValue(profile.show_instagram_badge, true),
        show_recent_views: booleanValue(profile.show_recent_views),
        is_private: booleanValue(profile.is_private)
      }
    });
  } catch (error) {
    console.error("profile update error", error);
    return wrap(context, 400, { error: errorMessage(error, "Có lỗi xảy ra khi xử lý Hồ sơ.") });
  }
}
