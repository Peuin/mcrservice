// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[app-search] background task failed", error));
}


const SEARCH_CACHE_TTL_SECONDS = 300;
const SEARCH_RECENT_CACHE_TTL_SECONDS = 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

async function discover(
  supabase: ReturnType<typeof createRequestClient>,
  url: URL,
  forceRefresh: boolean,
) {
  const query = stringValue(url.searchParams.get("q"));
  const limit = clampNumber(Number(url.searchParams.get("limit") ?? 8), 1, 20);
  const viewer = await getOptionalUser(supabase);

  if (query.length < 1) {
    const recent = await loadRecentCached(
      supabase,
      viewer?.id ?? null,
      forceRefresh,
      12,
    );
    return { recent, users: [], places: [], foods: [] };
  }

  const normalizedQuery = normalizeSearchKey(query);
  const [recent, users, places, foods] = await Promise.all([
    loadRecentCached(supabase, viewer?.id ?? null, forceRefresh, 12),
    loadUsers(supabase, normalizedQuery, query, limit, forceRefresh),
    loadPlaces(supabase, normalizedQuery, query, limit, forceRefresh),
    loadFoods(supabase, normalizedQuery, query, limit, forceRefresh),
  ]);

  return {
    recent,
    users,
    places,
    foods,
    viewerId: viewer?.id ?? null,
    cache: forceRefresh ? "bypass" : "redis",
  };
}

async function loadUsers(
  supabase: ReturnType<typeof createRequestClient>,
  normalizedQuery: string,
  query: string,
  limit: number,
  forceRefresh: boolean,
) {
  const cacheKey = buildUsersCacheKey(normalizedQuery, limit);
  if (!forceRefresh) {
    const cached = await redisGet<Json[]>(cacheKey);
    if (cached) return mapUsers(supabase, cached, query);
  }

  const { data, error } = await supabase.rpc("search_users", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;

  const rows = data as Json[] | null ?? [];
  await redisSet(cacheKey, rows, SEARCH_CACHE_TTL_SECONDS);
  return mapUsers(supabase, rows, query);
}

async function loadPlaces(
  supabase: ReturnType<typeof createRequestClient>,
  normalizedQuery: string,
  query: string,
  limit: number,
  forceRefresh: boolean,
) {
  const cacheKey = buildPlacesCacheKey(normalizedQuery, limit);
  if (!forceRefresh) {
    const cached = await redisGet<Json[]>(cacheKey);
    if (cached) return mapPlaces(cached, query);
  }

  const { data, error } = await supabase.rpc("search_places", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;

  const rows = data as Json[] | null ?? [];
  await redisSet(cacheKey, rows, SEARCH_CACHE_TTL_SECONDS);
  return mapPlaces(rows, query);
}

async function loadFoods(
  supabase: ReturnType<typeof createRequestClient>,
  normalizedQuery: string,
  query: string,
  limit: number,
  forceRefresh: boolean,
) {
  const cacheKey = buildFoodsCacheKey(normalizedQuery, limit);
  if (!forceRefresh) {
    const cached = await redisGet<Json[]>(cacheKey);
    if (cached) return mapFoods(cached, query);
  }

  const { data, error } = await supabase.rpc("search_foods", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;

  const rows = data as Json[] | null ?? [];
  await redisSet(cacheKey, rows, SEARCH_CACHE_TTL_SECONDS);
  return mapFoods(rows, query);
}

function mapUsers(
  supabase: ReturnType<typeof createRequestClient>,
  rows: Json[],
  query: string,
) {
  return rows.map((row) => ({
    id: stringValue(row.id),
    username: stringValue(row.username),
    authorName: stringValue(row.author_name),
    avatarUrl: avatarPublicUrl(supabase, row),
    subtitle: stringValue(row.subtitle) || "user",
    searchType: "user",
    targetId: stringValue(row.id),
    query,
  })).filter((item) => item.id);
}

function mapPlaces(rows: Json[], query: string) {
  return rows.map((row) => ({
    id: stringValue(row.id),
    name: stringValue(row.name),
    address: stringValue(row.address),
    postCount: numberValue(row.post_count),
    subtitle: stringValue(row.subtitle),
    searchType: "place",
    targetId: stringValue(row.id),
    query,
  })).filter((item) => item.id);
}

function mapFoods(rows: Json[], query: string) {
  return rows.map((row) => ({
    label: stringValue(row.label),
    postCount: numberValue(row.post_count),
    iconUrl: stringValue(row.icon_url) || null,
    subtitle: stringValue(row.subtitle),
    searchType: "food",
    targetId: normalizeFoodKey(stringValue(row.label)),
    query,
  })).filter((item) => item.label);
}

async function fetchPosts(
  supabase: ReturnType<typeof createRequestClient>,
  url: URL,
  forceRefresh: boolean,
) {
  const placeId = stringValue(url.searchParams.get("placeId"));
  const food = stringValue(url.searchParams.get("food"));
  const limit = clampNumber(Number(url.searchParams.get("limit") ?? 20), 1, 50);
  const viewer = await getOptionalUser(supabase);
  const viewerId = viewer?.id ?? null;

  if (placeId) {
    const cacheKey = buildPostsByPlaceCacheKey(placeId, limit, viewerId);
    if (!forceRefresh) {
      const cached = await redisGet<Json[]>(cacheKey);
      if (cached) {
        return {
          posts: hydratePosts(supabase, cached),
          context: { type: "place", placeId },
        };
      }
    }

    const { data, error } = await supabase.rpc("search_posts_by_place", {
      p_place_id: placeId,
      p_limit: limit,
      p_viewer_id: viewerId,
    });
    if (error) throw error;

    const rows = data as Json[] | null ?? [];
    await redisSet(cacheKey, rows, SEARCH_CACHE_TTL_SECONDS);
    return {
      posts: hydratePosts(supabase, rows),
      context: { type: "place", placeId },
    };
  }

  if (food) {
    const cacheKey = buildPostsByFoodCacheKey(food, limit, viewerId);
    if (!forceRefresh) {
      const cached = await redisGet<Json[]>(cacheKey);
      if (cached) {
        return {
          posts: hydratePosts(supabase, cached),
          context: { type: "food", food },
        };
      }
    }

    const { data, error } = await supabase.rpc("search_posts_by_food", {
      p_food_query: food,
      p_limit: limit,
      p_viewer_id: viewerId,
    });
    if (error) throw error;

    const rows = data as Json[] | null ?? [];
    await redisSet(cacheKey, rows, SEARCH_CACHE_TTL_SECONDS);
    return {
      posts: hydratePosts(supabase, rows),
      context: { type: "food", food },
    };
  }

  throw new Error("Thiếu placeId hoặc food để tải bài viết.");
}

async function fetchRecent(
  supabase: ReturnType<typeof createRequestClient>,
  forceRefresh: boolean,
  limit: number,
) {
  const viewer = await requireUser(supabase);
  return {
    recent: await loadRecentCached(supabase, viewer.id, forceRefresh, limit),
  };
}

async function loadRecentCached(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string | null,
  forceRefresh: boolean,
  limit: number,
) {
  if (!userId) {
    return [];
  }

  const cacheKey = buildRecentCacheKey(userId, limit);
  if (!forceRefresh) {
    const cached = await redisGet<Json[]>(cacheKey);
    if (cached) return cached;
  }

  const recent = await loadRecent(supabase, limit);
  await redisSet(cacheKey, recent, SEARCH_RECENT_CACHE_TTL_SECONDS);
  return recent;
}

async function loadRecent(
  supabase: ReturnType<typeof createRequestClient>,
  limit: number,
) {
  const viewer = await requireUser(supabase);
  const { data, error } = await supabase
    .from("search")
    .select("id,search_type,query,target_id,title,subtitle,image_url,updated_at")
    .eq("user_id", viewer.id)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data as Json[] | null ?? []).map((row) => ({
    id: stringValue(row.id),
    searchType: stringValue(row.search_type),
    query: stringValue(row.query),
    targetId: stringValue(row.target_id),
    title: stringValue(row.title),
    subtitle: stringValue(row.subtitle),
    imageUrl: stringValue(row.image_url) || null,
  }));
}

async function saveRecent(
  supabase: ReturnType<typeof createRequestClient>,
  request: PortedRequest,
) {
  const viewer = await requireUser(supabase);
  const body = await request.json().catch(() => ({}));
  const searchType = stringValue(body.searchType ?? body.search_type);
  const query = stringValue(body.query);
  const targetId = stringValue(body.targetId ?? body.target_id);
  const title = stringValue(body.title);
  const subtitle = stringValue(body.subtitle);
  const imageUrl = stringValue(body.imageUrl ?? body.image_url);

  if (!searchType || !query || !targetId || !title) {
    throw new Error("Thiếu dữ liệu lưu lịch sử tìm kiếm.");
  }

  const { data, error } = await supabase
    .from("search")
    .upsert({
      user_id: viewer.id,
      search_type: searchType,
      query,
      target_id: targetId,
      title,
      subtitle,
      image_url: imageUrl || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,search_type,target_id" })
    .select("id,search_type,query,target_id,title,subtitle,image_url,updated_at")
    .single();

  if (error) throw error;

  return {
    recent: {
      id: stringValue(data.id),
      searchType: stringValue(data.search_type),
      query: stringValue(data.query),
      targetId: stringValue(data.target_id),
      title: stringValue(data.title),
      subtitle: stringValue(data.subtitle),
      imageUrl: stringValue(data.image_url) || null,
    },
  };
}

async function deleteRecent(
  supabase: ReturnType<typeof createRequestClient>,
  id: string,
) {
  const viewer = await requireUser(supabase);
  if (!id) {
    throw new Error("Thiếu id lịch sử tìm kiếm.");
  }

  const { error } = await supabase
    .from("search")
    .delete()
    .eq("id", id)
    .eq("user_id", viewer.id);

  if (error) throw error;
  return { ok: true };
}

async function clearAllRecent(supabase: ReturnType<typeof createRequestClient>) {
  const viewer = await requireUser(supabase);
  const { error } = await supabase
    .from("search")
    .delete()
    .eq("user_id", viewer.id);

  if (error) throw error;
  return { ok: true };
}

function hydratePosts(
  supabase: ReturnType<typeof createRequestClient>,
  rows: Json[],
) {
  return rows.map((post) => ({
    ...post,
    media_url: publicStorageUrl(supabase, "post-media", stringValue(post.media_url)),
    avatar_url: avatarPublicUrl(supabase, post),
  }));
}

async function requireUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Bạn cần đăng nhập để tìm kiếm.");
  }
  return data.user;
}

async function getOptionalUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }
  return data.user;
}

function avatarPublicUrl(
  supabase: ReturnType<typeof createRequestClient>,
  profile?: Json | null,
) {
  const rawAvatar =
    stringValue(profile?.avatar_url) ||
    stringValue(profile?.avatar_path) ||
    stringValue(profile?.profile_avatar_url);

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

function normalizeFoodKey(label: string) {
  return label.trim().toLowerCase();
}

function normalizeSearchKey(query: string) {
  return query.trim().toLowerCase();
}

function buildUsersCacheKey(normalizedQuery: string, limit: number) {
  return `search:v1:users:${normalizedQuery}:${limit}`;
}

function buildPlacesCacheKey(normalizedQuery: string, limit: number) {
  return `search:v1:places:${normalizedQuery}:${limit}`;
}

function buildFoodsCacheKey(normalizedQuery: string, limit: number) {
  return `search:v2:foods:${normalizedQuery}:${limit}`;
}

function buildPostsByPlaceCacheKey(
  placeId: string,
  limit: number,
  viewerId: string | null,
) {
  return `search:v1:posts:place:${placeId}:${limit}:viewer:${viewerId ?? "anon"}`;
}

function buildPostsByFoodCacheKey(
  food: string,
  limit: number,
  viewerId: string | null,
) {
  return `search:v1:posts:food:${normalizeFoodKey(food)}:${limit}:viewer:${viewerId ?? "anon"}`;
}

function buildRecentCacheKey(userId: string, limit: number) {
  return `search:v1:recent:${userId}:${limit}`;
}

async function invalidateRecentCache(userId: string) {
  for (const limit of [12, 50, 100]) {
    await redisDel(buildRecentCacheKey(userId, limit));
  }
}

async function redisGet<T>(key: string): Promise<T | null> {
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
    return typeof result === "string" ? JSON.parse(result) as T : null;
  } catch (error) {
    console.warn("app-search redis get skipped", error);
    return null;
  }
}

async function redisSet(
  key: string,
  value: unknown,
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
    console.warn("app-search redis set skipped", error);
  }
}

async function redisDel(key: string): Promise<void> {
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
      body: JSON.stringify(["DEL", key]),
    });
  } catch (error) {
    console.warn("app-search redis del skipped", error);
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const parsed = Number(stringValue(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
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
  return "Có lỗi xảy ra khi tìm kiếm.";
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error as Json;
}

export async function handleAppSearch(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const supabase = createRequestClient(request);
    const forceRefresh = url.searchParams.has("refresh");

    if (request.method === "GET" && path.endsWith("/app-search/recent")) {
      const recentLimit = clampNumber(
        Number(url.searchParams.get("limit") ?? 50),
        1,
        100,
      );
      const recentForceRefresh =
        forceRefresh || url.searchParams.has("refresh");
      return jsonResponse(
        await fetchRecent(supabase, recentForceRefresh, recentLimit),
        200,
      );
    }

    if (request.method === "GET" && path.endsWith("/app-search/posts")) {
      return jsonResponse(
        await fetchPosts(supabase, url, forceRefresh),
        200,
      );
    }

    if (request.method === "GET" && path.endsWith("/app-search")) {
      return jsonResponse(await discover(supabase, url, forceRefresh), 200);
    }

    if (request.method === "POST" && path.endsWith("/app-search/recent")) {
      const body = await saveRecent(supabase, request);
      const viewer = await requireUser(supabase);
      await invalidateRecentCache(viewer.id);
      return jsonResponse(body, 200);
    }

    if (request.method === "DELETE" && path.includes("/app-search/recent")) {
      const lastSegment = path.split("/").pop() ?? "";
      const viewer = await requireUser(supabase);
      if (lastSegment === "recent") {
        const body = await clearAllRecent(supabase);
        await invalidateRecentCache(viewer.id);
        return jsonResponse(body, 200);
      }
      const body = await deleteRecent(supabase, lastSegment);
      await invalidateRecentCache(viewer.id);
      return jsonResponse(body, 200);
    }

    return jsonResponse({ error: "Không tìm thấy endpoint app-search." }, 404);
  } catch (error) {
    console.error("app-search error", error);
    return jsonResponse(
      { error: errorMessage(error), details: errorDetails(error) },
      400,
    );
  }

}
