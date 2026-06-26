// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { createHandlerSupabaseClient } from "../../shared/handler-supabase.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[home-feed] background task failed", error));
}


const HOME_FEED_CACHE_TTL_SECONDS = 300;
const HOME_FEED_RANK_MODEL_VERSION = "rank-v2";
const HOME_FEED_CACHE_VERSION_KEY = "home-feed:rank-v2:cache-version";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};



function createRequestClient(request: PortedRequest) {
  return createHandlerSupabaseClient(request);
}

async function fetchComments(
  supabase: ReturnType<typeof createRequestClient>,
  url: URL,
) {
  const postId = stringValue(url.searchParams.get("postId"));
  if (!postId) {
    throw new Error("Thiếu postId để tải bình luận.");
  }

  const { data, error } = await supabase
    .schema("social")
    .from("comments")
    .select("id,post_id,user_id,parent_comment_id,body,reaction_count,created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;

  const rows = Array.isArray(data) ? data as Json[] : [];
  const userIds = ids(rows, "user_id");
  const viewer = await currentUserProfile(supabase);
  const commentIds = ids(rows, "id");
  const likedCommentRows =
    viewer && commentIds.length > 0
      ? await selectMany(
          supabase
            .schema("social")
            .from("comment_reactions")
            .select("comment_id")
            .in("comment_id", commentIds)
            .eq("user_id", viewer.id)
            .eq("type", "love"),
        )
      : [];
  const likedCommentIds = new Set(likedCommentRows.map((row) => stringValue(row.comment_id)));
  const profileRows = userIds.length === 0 ? [] : await selectMany(
    supabase
      .from("profiles")
      .select("id,display_name,username,avatar_url")
      .in("id", userIds),
  );
  const profileById = byId(profileRows);

  const comments = rows.map((comment) => {
    const userId = stringValue(comment.user_id);
    const profile = profileById.get(userId);
    const viewerProfile = viewer?.id === userId ? viewer : null;

    return {
      ...comment,
      author_name:
        profileDisplayName(profile) || stringValue(viewerProfile?.author_name),
      author_username: stringValue(profile?.username),
      avatar_url:
        avatarPublicUrl(supabase, profile) ||
        stringValue(viewerProfile?.avatar_url) ||
        null,
      liked_by_me: likedCommentIds.has(stringValue(comment.id)),
    };
  });

  return { comments, currentUser: viewer };
}

async function currentUserProfile(supabase: ReturnType<typeof createRequestClient>) {
  const user = await getOptionalUser(supabase);
  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name,username,avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;

  const profile = data as Json | null;
  const email = stringValue(user.email);
  return {
    id: user.id,
    author_name: profileDisplayName(profile, user.user_metadata) || email,
    avatar_url: avatarPublicUrl(supabase, profile, user.user_metadata),
  };
}

type HomeFeedPageResponse = {
  posts: Json[];
  nextCursorCreatedAt: string | null;
};

function buildHomeFeedCacheKey(options: {
  viewerId: string | null;
  limit: number;
  cursorCreatedAt: string | null;
  feedSeed?: string | null;
  cacheVersion: string;
}): string {
  return [
    "home-feed",
    HOME_FEED_RANK_MODEL_VERSION,
    `v:${options.cacheVersion}`,
    `viewer:${options.viewerId ?? "anonymous"}`,
    `limit:${options.limit}`,
    `cursor:${options.cursorCreatedAt ?? "first"}`,
    `seed:${options.cursorCreatedAt == null ? (options.feedSeed ?? "default") : "none"}`,
  ].join(":");
}

async function redisCommand(
  command: unknown[],
  label: string,
): Promise<unknown | null> {
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
      body: JSON.stringify(command),
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    return payload?.result ?? null;
  } catch (error) {
    console.warn(`home-feed redis ${label} skipped`, error);
    return null;
  }
}

async function redisGet(key: string): Promise<Json | null> {
  const result = await redisCommand(["GET", key], "get");
  if (typeof result !== "string") return null;

  try {
    return JSON.parse(result) as Json;
  } catch (error) {
    console.warn("home-feed redis parse skipped", error);
    return null;
  }
}

async function redisSet(
  key: string,
  value: Json,
  ttlSeconds: number,
): Promise<void> {
  await redisCommand([
    "SET",
    key,
    JSON.stringify(value),
    "EX",
    ttlSeconds,
  ], "set");
}

async function homeFeedCacheVersion(): Promise<string> {
  const result = await redisCommand(["GET", HOME_FEED_CACHE_VERSION_KEY], "version get");
  return typeof result === "string" && result.trim().length > 0 ? result : "0";
}

async function bumpHomeFeedCacheVersion(): Promise<void> {
  await redisCommand(["INCR", HOME_FEED_CACHE_VERSION_KEY], "version bump");
}

async function loadHomeFeedPage(
  supabase: ReturnType<typeof createRequestClient>,
  options: {
    limit: number;
    cursorCreatedAt?: string | null;
    viewerId?: string | null;
    feedSeed?: string | null;
    forceRefresh?: boolean;
    cacheTtlSeconds?: number;
  },
): Promise<HomeFeedPageResponse> {
  const limit = clampNumber(options.limit, 1, 50);
  const cursorCreatedAt = options.cursorCreatedAt ?? null;
  const viewerId = options.viewerId ?? null;
  const feedSeed = cursorCreatedAt == null
    ? (stringValue(options.feedSeed).trim() || "peuin")
    : null;
  const forceRefresh = options.forceRefresh ?? false;
  const cacheTtlSeconds = options.cacheTtlSeconds ?? HOME_FEED_CACHE_TTL_SECONDS;
  const cacheVersion = await homeFeedCacheVersion();

  const cacheKey = buildHomeFeedCacheKey({
    viewerId,
    limit,
    cursorCreatedAt,
    feedSeed,
    cacheVersion,
  });

  if (!forceRefresh) {
    const cached = await redisGet(cacheKey);
    if (cached && Array.isArray(cached.posts)) {
      return {
        posts: cached.posts as Json[],
        nextCursorCreatedAt: stringValue(cached.nextCursorCreatedAt) || null,
      };
    }
  }

  const { data, error } = await supabase.schema("social").rpc("home_feed_posts", {
    p_limit: limit,
    p_cursor_created_at: cursorCreatedAt,
    p_viewer_id: viewerId,
    p_feed_seed: feedSeed,
  });
  if (error) throw error;

  const rows = Array.isArray(data) ? data as Json[] : [];
  const hydratedPosts = rows.map((post) => ({
    ...post,
    media_url: publicStorageUrl(supabase, "post-media", stringValue(post.media_url)),
    avatar_url: avatarPublicUrl(supabase, post),
  }));
  const orderedPosts = seededFirstPageOrder(hydratedPosts, feedSeed, cursorCreatedAt);
  const response: HomeFeedPageResponse = {
    posts: orderedPosts,
    nextCursorCreatedAt: minCreatedAt(orderedPosts),
  };

  await redisSet(cacheKey, response, cacheTtlSeconds);
  return response;
}

function minCreatedAt(posts: Json[]): string | null {
  let minValue = "";
  let minTime = Number.POSITIVE_INFINITY;

  for (const post of posts) {
    const createdAt = stringValue(post.created_at);
    if (!createdAt) continue;

    const time = Date.parse(createdAt);
    if (!Number.isFinite(time)) continue;

    if (time < minTime) {
      minTime = time;
      minValue = createdAt;
    }
  }

  return minValue || null;
}

function seededFirstPageOrder(
  posts: Json[],
  feedSeed: string | null,
  cursorCreatedAt: string | null,
): Json[] {
  if (cursorCreatedAt != null || posts.length <= 1) {
    return posts;
  }

  const seed = stringValue(feedSeed) || "peuin";
  return [...posts].sort((a, b) => {
    const aKey = seededUnit(`${seed}:${stringValue(a.id)}`);
    const bKey = seededUnit(`${seed}:${stringValue(b.id)}`);
    if (aKey !== bKey) return aKey - bKey;
    return stringValue(b.created_at).localeCompare(stringValue(a.created_at));
  });
}

function seededUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

async function hydrateFeedPost(
  supabase: ReturnType<typeof createRequestClient>,
  postId: string,
  viewerId: string,
): Promise<Json | null> {
  const { data, error } = await supabase.schema("social").rpc("home_feed_post_by_id", {
    p_post_id: postId,
    p_viewer_id: viewerId,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? (data[0] as Json | undefined) : (data as Json | null);
  if (!row) return null;

  return {
    ...row,
    media_url: publicStorageUrl(supabase, "post-media", stringValue(row.media_url)),
    avatar_url: avatarPublicUrl(supabase, row),
  };
}

async function fetchFeed(supabase: ReturnType<typeof createRequestClient>, url: URL) {
  const limit = clampNumber(Number(url.searchParams.get("limit") ?? 20), 1, 50);
  const cursorCreatedAt = url.searchParams.get("cursorCreatedAt");
  const refreshToken = url.searchParams.get("refresh");
  const feedSeed = url.searchParams.get("feedSeed") ??
    url.searchParams.get("feed_seed") ??
    (refreshToken ? `refresh:${refreshToken}` : null);
  const forceRefresh = url.searchParams.has("refresh");
  const user = await getOptionalUser(supabase);

  return loadHomeFeedPage(supabase, {
    limit,
    cursorCreatedAt,
    viewerId: user?.id ?? null,
    feedSeed,
    forceRefresh,
  });
}

async function fetchPost(supabase: ReturnType<typeof createRequestClient>, url: URL) {
  const user = await requireUser(supabase);
  const postId = stringValue(url.searchParams.get("postId") ?? url.searchParams.get("id"));
  if (!postId) {
    throw new Error("Thiếu postId để tải bài viết.");
  }

  const post = await hydrateFeedPost(supabase, postId, user.id);
  if (!post) {
    throw new Error("Không tìm thấy bài viết.");
  }

  return { post };
}

async function fetchMutualFriends(
  supabase: ReturnType<typeof createRequestClient>,
  url: URL,
) {
  await requireUser(supabase);
  const query = stringValue(url.searchParams.get("q")).trim();
  const limit = clampNumber(Number(url.searchParams.get("limit") ?? 12), 1, 30);

  const { data, error } = await supabase.schema("social").rpc("list_mutual_friends", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;

  return {
    friends: Array.isArray(data) ? data : [],
  };
}

async function fetchTopicHot(
  supabase: ReturnType<typeof createRequestClient>,
  url: URL,
) {
  const slug = normalizeTopicSlug(stringValue(url.searchParams.get("slug")));
  if (!slug) {
    throw new Error("Thiếu slug chủ đề.");
  }

  const minPosts = clampNumber(Number(url.searchParams.get("minPosts") ?? 3), 1, 50);
  const withinDays = clampNumber(Number(url.searchParams.get("withinDays") ?? 7), 1, 90);

  const { data: countData, error: countError } = await supabase.schema("social").rpc(
    "topic_discussion_count",
    { p_slug: slug, p_within_days: withinDays },
  );
  if (countError) throw countError;

  const { data: totalData, error: totalError } = await supabase.schema("core").rpc(
    "topic_total_post_count",
    { p_slug: slug },
  );
  if (totalError) throw totalError;

  const { data: hotData, error: hotError } = await supabase.schema("social").rpc("is_topic_hot", {
    p_slug: slug,
    p_min_posts: minPosts,
    p_within_days: withinDays,
  });
  if (hotError) throw hotError;

  const recentCount = Number(countData ?? 0);
  const postCount = Number(totalData ?? 0);
  return {
    slug,
    count: Number.isFinite(recentCount) ? recentCount : 0,
    postCount: Number.isFinite(postCount) ? postCount : 0,
    hot: booleanValue(hotData),
  };
}

function normalizeTopicSlug(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

async function toggleLove(
  supabase: ReturnType<typeof createRequestClient>,
  request: PortedRequest,
) {
  const { user } = await requireUser(supabase);
  const body = await request.json().catch(() => ({}));
  const postId = stringValue(body.postId);

  if (!postId) {
    throw new Error("Thiếu postId để thả tim.");
  }

  const { data: existingRows, error: existingError } = await supabase
    .schema("social")
    .from("reactions")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", user.id)
    .eq("type", "love")
    .limit(1);

  if (existingError) throw existingError;

  const existing = existingRows?.[0];
  if (existing) {
    const { error } = await supabase
      .schema("social")
      .from("reactions")
      .delete()
      .eq("id", existing.id);
    if (error) throw error;
    await bumpHomeFeedCacheVersion();
    return { likedByMe: false };
  }

  const { error } = await supabase.schema("social").from("reactions").insert({
    post_id: postId,
    user_id: user.id,
    type: "love",
  });
  if (error) throw error;

  await bumpHomeFeedCacheVersion();
  return { likedByMe: true };
}

async function createPost(
  supabase: ReturnType<typeof createRequestClient>,
  request: PortedRequest,
) {
  const { user } = await requireUser(supabase);
  const body = await request.json().catch(() => ({}));
  const mediaPath = normalizeStoragePath(stringValue(body.mediaPath ?? body.media_path));
  const caption = stringValue(body.caption).trim();
  const placeIdInput = stringValue(body.placeId ?? body.place_id).trim();
  const placeName = stringValue(body.placeName ?? body.place_name).trim();
  const priceLabel = stringValue(body.priceLabel ?? body.price_label).trim();
  const foodLabel = stringValue(body.foodLabel ?? body.food_label).trim();
  const frameIdInput = stringValue(body.frameId ?? body.frame_id).trim();
  const frameLabel = stringValue(body.frameLabel ?? body.frame_label).trim();
  const plainLayout = booleanValue(body.plainLayout ?? body.plain_layout) ||
    frameLabel.toLowerCase() === "peuin_plain";
  const visibility = normalizePostVisibility(
    body.visibility ?? body.postVisibility ?? body.post_visibility,
  );
  const promptMode = stringValue(body.promptMode ?? body.prompt_mode).trim();
  const prompt = stringValue(body.prompt).trim();
  const rawTags = Array.isArray(body.tags) ? body.tags : [];
  const tags = rawTags.map(stringValue).map((tag) => tag.trim()).filter(Boolean);
  const rawMentions = Array.isArray(body.mentions) ? body.mentions : [];
  const mentions = rawMentions
    .map(stringValue)
    .map((value) => value.trim().replace(/^@+/, "").toLowerCase())
    .filter(Boolean);
  const rawTopics = Array.isArray(body.topics) ? body.topics : [];
  const topics = rawTopics
    .map(stringValue)
    .map((value) => normalizeTopicSlug(value.replace(/^#+/, "")))
    .filter(Boolean);

  if (!caption) {
    throw new Error("Nhập caption trước đã nha.");
  }
  if (!mediaPath) {
    throw new Error("Thiếu ảnh để đăng bài.");
  }
  if (!mediaPath.startsWith(`${user.id}/`)) {
    throw new Error("Ảnh đăng bài không thuộc tài khoản hiện tại.");
  }

  const placeId = placeIdInput
    ? await requirePlace(supabase, placeIdInput)
    : placeName
    ? await findOrCreatePlace(supabase, placeName)
    : null;
  let frame: FrameRow | null = null;
  if (frameIdInput) {
    frame = await requireOwnedFrame(supabase, user.id, frameIdInput);
  } else if (!plainLayout && !frameLabel) {
    frame = await ensureDefaultFrame(supabase, user.id);
  }
  let postId = "";

  try {
    const post = await insertPost(supabase, {
      user_id: user.id,
      place_id: placeId,
      frame_id: plainLayout ? null : frame?.id ?? null,
      caption,
      price_label: priceLabel || null,
      visibility,
    });

    postId = stringValue((post as Json | null)?.id);
    if (!postId) {
      throw new Error("Không nhận được mã bài đăng.");
    }

    const { error: mediaError } = await supabase.schema("social").from("post_media").insert({
      post_id: postId,
      url: mediaPath,
      sort_order: 0,
    });
    if (mediaError) throw mediaError;

    const frameStickerLabel = plainLayout
      ? (frameLabel || "peuin_plain")
      : (frame?.name || frameLabel);

    const stickers = [
      stickerRow(postId, "food", foodLabel),
      stickerRow(postId, "frame", frameStickerLabel),
      stickerRow(postId, "prompt_mode", promptMode),
      stickerRow(postId, "prompt", prompt),
      ...tags.map((tag) => stickerRow(postId, "tag", tag)),
      ...mentions.map((username) => stickerRow(postId, "mention", username)),
      ...topics.map((slug) => stickerRow(postId, "topic", slug)),
    ].filter((row): row is Json => row !== null);

    const postTasks: Promise<void>[] = [
      insertPostStickers(supabase, stickers),
    ];
    if (topics.length > 0) {
      postTasks.push(registerPostTopics(supabase, postId, topics));
    }
    await Promise.all(postTasks);

    const feedPost = await hydrateFeedPost(supabase, postId, user.id);
    await bumpHomeFeedCacheVersion();

    return {
      post: {
        id: postId,
        mediaPath,
      },
      feedPost,
    };
  } catch (error) {
    if (postId) {
      const { error: cleanupError } = await supabase
        .schema("social")
        .from("posts")
        .delete()
        .eq("id", postId)
        .eq("user_id", user.id);
      if (cleanupError) {
        console.warn("home-feed post cleanup failed", cleanupError);
      }
    }
    throw error;
  }
}

function normalizePostVisibility(value: unknown): "public" | "followers" | "private" {
  const raw = stringValue(value).trim().toLowerCase();
  if (
    raw === "followers" ||
    raw === "friends" ||
    raw === "friend" ||
    raw === "ban_be" ||
    raw === "bạn bè" ||
    raw === "ban be"
  ) {
    return "followers";
  }
  if (
    raw === "private" ||
    raw === "only_me" ||
    raw === "onlyme" ||
    raw === "chi_minh_toi" ||
    raw === "chỉ mình tôi" ||
    raw === "chi minh toi"
  ) {
    return "private";
  }
  return "public";
}

async function insertPost(
  supabase: ReturnType<typeof createRequestClient>,
  row: Json,
) {
  const result = await supabase
    .schema("social")
    .from("posts")
    .insert(row)
    .select("id")
    .single();

  if (!result.error) {
    return result.data as Json;
  }

  if (isMissingColumnError(result.error, "price_label")) {
    const { price_label: _priceLabel, ...fallbackRow } = row;
    return await insertPost(supabase, fallbackRow);
  }

  if (isMissingColumnError(result.error, "frame_id")) {
    const { frame_id: _frameId, ...fallbackRow } = row;
    return await insertPost(supabase, fallbackRow);
  }

  if (isMissingColumnError(result.error, "visibility")) {
    const { visibility: _visibility, ...fallbackRow } = row;
    return await insertPost(supabase, fallbackRow);
  }

  throw result.error;
}

type FrameRow = {
  id: string;
  name: string;
  template_key: string;
  image_path: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  is_default: boolean;
};

async function fetchFrames(supabase: ReturnType<typeof createRequestClient>) {
  const { user } = await requireUser(supabase);
  await ensureDefaultFrame(supabase, user.id);
  const frames = await listUserFrames(supabase, user.id);
  return { frames: frames.map((frame) => frameResponse(supabase, frame)) };
}

async function saveFrame(
  supabase: ReturnType<typeof createRequestClient>,
  request: PortedRequest,
) {
  const { user } = await requireUser(supabase);
  const body = await request.json().catch(() => ({}));
  const frameId = stringValue(body.id ?? body.frameId ?? body.frame_id);
  const makeDefault = booleanValue(body.isDefault ?? body.is_default);
  const row = {
    user_id: user.id,
    name: stringValue(body.name) || "Khung của tôi",
    template_key: stringValue(body.templateKey ?? body.template_key) || "polaroid",
    image_path: normalizeStoragePath(stringValue(body.imagePath ?? body.image_path)),
    primary_color: normalizeHexColor(body.primaryColor ?? body.primary_color, "#FF5F75"),
    secondary_color: normalizeHexColor(body.secondaryColor ?? body.secondary_color, "#FF8A22"),
    accent_color: normalizeHexColor(body.accentColor ?? body.accent_color, "#FF4A1F"),
    is_default: false,
    updated_at: new Date().toISOString(),
  };

  if (row.image_path && !row.image_path.startsWith(`${user.id}/`)) {
    throw new Error("Ảnh frame không thuộc tài khoản hiện tại.");
  }

  let saved: Json | null = null;
  if (frameId) {
    await requireOwnedFrame(supabase, user.id, frameId);
    const { data, error } = await supabase
      .schema("core")
      .from("frames")
      .update(row)
      .eq("id", frameId)
      .eq("user_id", user.id)
      .select(frameSelect)
      .single();
    if (error) throw error;
    saved = data as Json;
  } else {
    const { data, error } = await supabase
      .schema("core")
      .from("frames")
      .insert(row)
      .select(frameSelect)
      .single();
    if (error) throw error;
    saved = data as Json;
  }

  const savedId = stringValue(saved?.id);
  if (makeDefault && savedId) {
    await markFrameDefault(supabase, user.id, savedId);
    saved = await requireOwnedFrame(supabase, user.id, savedId);
  }

  return { frame: frameResponse(supabase, toFrameRow(saved)) };
}

async function setDefaultFrame(
  supabase: ReturnType<typeof createRequestClient>,
  request: PortedRequest,
) {
  const { user } = await requireUser(supabase);
  const body = await request.json().catch(() => ({}));
  const frameId = stringValue(body.frameId ?? body.frame_id ?? body.id);
  if (!frameId) {
    throw new Error("Thiếu frameId để chọn khung mặc định.");
  }

  await requireOwnedFrame(supabase, user.id, frameId);
  await markFrameDefault(supabase, user.id, frameId);
  const frame = await requireOwnedFrame(supabase, user.id, frameId);
  return { frame: frameResponse(supabase, frame) };
}

const frameSelect =
  "id,name,template_key,image_path,primary_color,secondary_color,accent_color,is_default";

async function listUserFrames(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
) {
  const { data, error } = await supabase
    .schema("core")
      .from("frames")
    .select(frameSelect)
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data.map(toFrameRow) : [];
}

async function ensureDefaultFrame(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
) {
  const { data, error } = await supabase
    .schema("core")
      .from("frames")
    .select(frameSelect)
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    return toFrameRow(data as Json);
  }

  const frames = await listUserFrames(supabase, userId);
  if (frames.length > 0) {
    await markFrameDefault(supabase, userId, frames[0].id);
    return await requireOwnedFrame(supabase, userId, frames[0].id);
  }

  const { data: created, error: createError } = await supabase
    .schema("core")
      .from("frames")
    .insert({
      user_id: userId,
      name: "Polaroid cam",
      template_key: "polaroid",
      primary_color: "#FF5F75",
      secondary_color: "#FF8A22",
      accent_color: "#FF4A1F",
      is_default: true,
    })
    .select(frameSelect)
    .single();
  if (createError) throw createError;
  return toFrameRow(created as Json);
}

async function requireOwnedFrame(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
  frameId: string,
) {
  const { data, error } = await supabase
    .schema("core")
      .from("frames")
    .select(frameSelect)
    .eq("id", frameId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("Không tìm thấy khung của bạn.");
  }
  return toFrameRow(data as Json);
}

async function markFrameDefault(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
  frameId: string,
) {
  const { error: clearError } = await supabase
    .schema("core")
      .from("frames")
    .update({ is_default: false })
    .eq("user_id", userId);
  if (clearError) throw clearError;

  const { error: updateError } = await supabase
    .schema("core")
      .from("frames")
    .update({ is_default: true })
    .eq("id", frameId)
    .eq("user_id", userId);
  if (updateError) throw updateError;
}

function toFrameRow(row?: Json | null): FrameRow {
  return {
    id: stringValue(row?.id),
    name: stringValue(row?.name) || "Khung của tôi",
    template_key: stringValue(row?.template_key) || "polaroid",
    image_path: stringValue(row?.image_path),
    primary_color: normalizeHexColor(row?.primary_color, "#FF5F75"),
    secondary_color: normalizeHexColor(row?.secondary_color, "#FF8A22"),
    accent_color: normalizeHexColor(row?.accent_color, "#FF4A1F"),
    is_default: booleanValue(row?.is_default),
  };
}

function frameResponse(
  supabase: ReturnType<typeof createRequestClient>,
  frame: FrameRow,
) {
  return {
    id: frame.id,
    name: frame.name,
    template_key: frame.template_key,
    image_path: frame.image_path,
    image_url: publicStorageUrl(supabase, "frame", frame.image_path),
    primary_color: frame.primary_color,
    secondary_color: frame.secondary_color,
    accent_color: frame.accent_color,
    is_default: frame.is_default,
  };
}

async function findOrCreatePlace(
  supabase: ReturnType<typeof createRequestClient>,
  name: string,
) {
  const { data: existing, error: existingError } = await supabase
    .schema("core")
    .from("places")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  if (existingError) throw existingError;

  const existingId = stringValue((existing as Json | null)?.id);
  if (existingId) {
    return existingId;
  }

  const { data: created, error: createError } = await supabase
    .schema("core")
    .from("places")
    .insert({ name })
    .select("id")
    .single();
  if (createError) throw createError;

  const createdId = stringValue((created as Json | null)?.id);
  if (!createdId) {
    throw new Error("Không tạo được địa điểm cho bài đăng.");
  }
  return createdId;
}

async function requirePlace(
  supabase: ReturnType<typeof createRequestClient>,
  placeId: string,
) {
  const { data, error } = await supabase
    .schema("core")
    .from("places")
    .select("id")
    .eq("id", placeId)
    .maybeSingle();
  if (error) throw error;

  const existingId = stringValue((data as Json | null)?.id);
  if (!existingId) {
    throw new Error("Không tìm thấy địa điểm đã chọn.");
  }
  return existingId;
}

function stickerRow(postId: string, stickerType: string, label: string) {
  const cleanLabel = label.trim();
  if (!cleanLabel) return null;
  return {
    post_id: postId,
    sticker_type: stickerType,
    label: cleanLabel,
  };
}

async function insertPostStickers(
  supabase: ReturnType<typeof createRequestClient>,
  stickers: Json[],
) {
  if (stickers.length === 0) return;

  let { error } = await supabase
    .schema("social")
    .from("post_stickers")
    .insert(stickers);

  if (isPostStickerPositionRequiredError(error)) {
    const positionedStickers = stickers.map((sticker) =>
      withDefaultStickerPosition(sticker)
    );
    const retry = await supabase
      .schema("social")
      .from("post_stickers")
      .insert(positionedStickers);
    error = retry.error;
  }

  if (!error) return;

  if (isStickerTypeEnumError(error)) {
    const foodStickers = stickers.filter(
      (sticker) => stringValue(sticker.sticker_type) === "food",
    );
    if (foodStickers.length > 0) {
      const foodRetry = await supabase
        .schema("social")
        .from("post_stickers")
        .insert(foodStickers);
      if (!foodRetry.error) {
        console.warn("post_sticker metadata partially skipped (enum)", error);
        return;
      }
      error = foodRetry.error;
    }
  }

  throw error;
}

async function registerPostTopics(
  supabase: ReturnType<typeof createRequestClient>,
  postId: string,
  topics: string[],
) {
  const uniqueTopics = [...new Set(topics.map((slug) => normalizeTopicSlug(slug)).filter(Boolean))];
  if (uniqueTopics.length === 0) return;

  await Promise.all(
    uniqueTopics.map(async (slug) => {
      const { error } = await supabase.schema("core").rpc("register_post_topic", {
        p_post_id: postId,
        p_slug: slug,
        p_label: slug,
      });
      if (error) throw error;
    }),
  );
}

function isStickerTypeEnumError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("invalid input value for enum sticker_type");
}

function isPostStickerPositionRequiredError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("null value in column") &&
    message.includes("violates not-null constraint") &&
    (
      message.includes('"x_pos"') ||
      message.includes('"y_pos"') ||
      message.includes('"scale"') ||
      message.includes('"rotation"')
    );
}

function withDefaultStickerPosition(sticker: Json): Json {
  return {
    ...sticker,
    x_pos: 0,
    y_pos: 0,
    scale: 1,
    rotation: 0,
  };
}

async function addComment(
  supabase: ReturnType<typeof createRequestClient>,
  request: PortedRequest,
) {
  const { user } = await requireUser(supabase);
  const body = await request.json().catch(() => ({}));
  const postId = stringValue(body.postId);
  const parentCommentId = stringValue(body.parentCommentId ?? body.parent_comment_id);
  const comment = stringValue(body.body).trim();

  if (!postId) {
    throw new Error("Thiếu postId để bình luận.");
  }
  if (!comment) {
    throw new Error("Nhập bình luận trước đã nha.");
  }

  let rootParentCommentId: string | null = null;
  if (parentCommentId) {
    const { data: parentComment, error: parentError } = await supabase
      .schema("social")
      .from("comments")
      .select("id,post_id,parent_comment_id")
      .eq("id", parentCommentId)
      .eq("post_id", postId)
      .maybeSingle();
    if (parentError) throw parentError;
    if (!parentComment) {
      throw new Error("Không tìm thấy bình luận để trả lời.");
    }
    rootParentCommentId =
      stringValue(parentComment.parent_comment_id) || stringValue(parentComment.id);
  }

  const { error } = await supabase.schema("social").from("comments").insert({
    post_id: postId,
    user_id: user.id,
    parent_comment_id: rootParentCommentId,
    body: comment,
  });
  if (error) throw error;

  await bumpHomeFeedCacheVersion();
  return { comment };
}

async function toggleCommentLove(
  supabase: ReturnType<typeof createRequestClient>,
  request: PortedRequest,
) {
  const { user } = await requireUser(supabase);
  const body = await request.json().catch(() => ({}));
  const commentId = stringValue(body.commentId ?? body.comment_id);

  if (!commentId) {
    throw new Error("Thiếu commentId để thả tim bình luận.");
  }

  const { data: existingRows, error: existingError } = await supabase
    .schema("social")
    .from("comment_reactions")
    .select("id")
    .eq("comment_id", commentId)
    .eq("user_id", user.id)
    .eq("type", "love")
    .limit(1);

  if (existingError) throw existingError;

  const existing = existingRows?.[0];
  if (existing) {
    const { error } = await supabase
      .schema("social")
      .from("comment_reactions")
      .delete()
      .eq("id", existing.id);
    if (error) throw error;
    return { likedByMe: false };
  }

  const { error } = await supabase.schema("social").from("comment_reactions").insert({
    comment_id: commentId,
    user_id: user.id,
    type: "love",
  });
  if (error) throw error;

  return { likedByMe: true };
}

async function fetchReactionUsers(
  supabase: ReturnType<typeof createRequestClient>,
  url: URL,
) {
  const targetType = stringValue(url.searchParams.get("targetType"));
  const targetId = stringValue(url.searchParams.get("targetId"));

  if (!targetId) {
    throw new Error("Thiếu targetId để tải danh sách yêu thích.");
  }

  const reactionTable = targetType === "comment" ? "comment_reactions" : "reactions";
  const idColumn = targetType === "comment" ? "comment_id" : "post_id";

  const reactionRows = await selectMany(
    supabase
      .schema("social")
      .from(reactionTable)
      .select("user_id,created_at")
      .eq(idColumn, targetId)
      .eq("type", "love")
      .order("created_at", { ascending: false })
      .limit(100),
  );

  const userIds = ids(reactionRows, "user_id");
  const profileRows = userIds.length === 0 ? [] : await selectMany(
    supabase
      .from("profiles")
      .select("id,display_name,username,avatar_url")
      .in("id", userIds),
  );
  const profileById = byId(profileRows);

  const users = reactionRows.map((reaction) => {
    const userId = stringValue(reaction.user_id);
    const profile = profileById.get(userId);

    return {
      id: userId,
      author_name: profileDisplayName(profile) || "Bạn ăn ngon",
      username: stringValue(profile?.username),
      avatar_url: avatarPublicUrl(supabase, profile),
    };
  });

  return { users };
}

async function requireUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Bạn cần đăng nhập để dùng Home Feed.");
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

function byId(rows: Json[]) {
  return firstBy(rows, "id");
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

function normalizeStoragePath(path: string) {
  return path.replace(/^\/+/, "").trim();
}

function normalizeHexColor(value: unknown, fallback: string) {
  const text = stringValue(value);
  if (/^#[0-9a-fA-F]{6}$/.test(text)) {
    return text.toUpperCase();
  }
  return fallback;
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = stringValue(value).toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return fallback;
}

function isMissingColumnError(error: unknown, column: string) {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const typed = error as { code?: unknown; message?: unknown };
  return typed.code === "PGRST204" && stringValue(typed.message).includes(`'${column}'`);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
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
  return "Có lỗi xảy ra khi xử lý Home Feed.";
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error as Json;
}

export async function handleHomeFeed(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const supabase = createRequestClient(request);

    if (request.method === "GET" && path.endsWith("/home-feed")) {
      return jsonResponse(await fetchFeed(supabase, url), 200);
    }

    if (request.method === "GET" && path.endsWith("/home-feed/comments")) {
      return jsonResponse(await fetchComments(supabase, url), 200);
    }

    if (request.method === "GET" && path.endsWith("/home-feed/post")) {
      return jsonResponse(await fetchPost(supabase, url), 200);
    }

    if (request.method === "POST" && path.endsWith("/home-feed/love")) {
      return jsonResponse(await toggleLove(supabase, request), 200);
    }

    if (
      request.method === "POST" &&
      (path.endsWith("/home-feed/post") || path.endsWith("/home-feed"))
    ) {
      return jsonResponse(await createPost(supabase, request), 201);
    }

    if (request.method === "POST" && path.endsWith("/home-feed/comment")) {
      return jsonResponse(await addComment(supabase, request), 200);
    }

    if (request.method === "POST" && path.endsWith("/home-feed/comment-love")) {
      return jsonResponse(await toggleCommentLove(supabase, request), 200);
    }

    if (request.method === "GET" && path.endsWith("/home-feed/reactions")) {
      return jsonResponse(await fetchReactionUsers(supabase, url), 200);
    }

    if (request.method === "GET" && path.endsWith("/home-feed/friends")) {
      return jsonResponse(await fetchMutualFriends(supabase, url), 200);
    }

    if (request.method === "GET" && path.endsWith("/home-feed/topic-hot")) {
      return jsonResponse(await fetchTopicHot(supabase, url), 200);
    }

    if (request.method === "GET" && path.endsWith("/home-feed/frames")) {
      return jsonResponse(await fetchFrames(supabase), 200);
    }

    if (request.method === "POST" && path.endsWith("/home-feed/frames")) {
      return jsonResponse(await saveFrame(supabase, request), 200);
    }

    if (request.method === "POST" && path.endsWith("/home-feed/frames/default")) {
      return jsonResponse(await setDefaultFrame(supabase, request), 200);
    }

    return jsonResponse({ error: "Không tìm thấy endpoint home-feed." }, 404);
  } catch (error) {
    console.error("home-feed error", error);
    return jsonResponse({ error: errorMessage(error), details: errorDetails(error) }, 400);
  }

}
