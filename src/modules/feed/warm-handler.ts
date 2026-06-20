// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[home-feed-warm] background task failed", error));
}


const HOME_FEED_CACHE_TTL_SECONDS = 300;
const HOME_FEED_WARM_LIMIT = 20;
const HOME_FEED_WARM_VIEWER_LIMIT = 50;
const HOME_FEED_RANK_MODEL_VERSION = "rank-v2";
const HOME_FEED_CACHE_VERSION_KEY = "home-feed:rank-v2:cache-version";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};



function assertWarmAuthorized(request: PortedRequest) {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Unauthorized warm request");
  }

  const authorization = readHeader(request.headers, "authorization") ?? "";
  if (authorization === `Bearer ${serviceRoleKey}`) {
    return;
  }

  const cronSecret = env.HOME_FEED_WARM_SECRET;
  const providedSecret = readHeader(request.headers, "x-cron-secret") ?? "";
  if (cronSecret && providedSecret === cronSecret) {
    return;
  }

  throw new Error("Unauthorized warm request");
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
    console.warn(`home-feed-warm redis ${label} skipped`, error);
    return null;
  }
}

async function redisGet(key: string): Promise<Json | null> {
  const result = await redisCommand(["GET", key], "get");
  if (typeof result !== "string") return null;

  try {
    return JSON.parse(result) as Json;
  } catch (error) {
    console.warn("home-feed-warm redis parse skipped", error);
    return null;
  }
}

function isRedisConfigured() {
  return Boolean(
    env.UPSTASH_REDIS_REST_URL &&
      env.UPSTASH_REDIS_REST_TOKEN,
  );
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

async function loadHomeFeedPage(
  supabase: SupabaseClient,
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

async function loadWarmViewerIds(supabase: SupabaseClient) {
  const limit = clampNumber(
    Number(
      env.HOME_FEED_WARM_VIEWER_LIMIT ??
        HOME_FEED_WARM_VIEWER_LIMIT,
    ),
    0,
    200,
  );
  if (limit < 1) return [] as string[];

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    console.warn("home-feed-warm viewer list skipped", error);
    return [] as string[];
  }

  return (data as Json[] | null ?? [])
    .map((row) => stringValue(row.id))
    .filter((id) => id.length > 0);
}

function avatarPublicUrl(supabase: SupabaseClient, profile?: Json | null) {
  const rawAvatar =
    stringValue(profile?.avatar_url) ||
    stringValue(profile?.avatar_path) ||
    stringValue(profile?.profile_avatar_url);

  return publicStorageUrl(supabase, "avata", rawAvatar);
}

function publicStorageUrl(
  supabase: SupabaseClient,
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

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export async function handleHomeFeedWarm(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    assertWarmAuthorized(request);

    const supabaseUrl = env.SUPABASE_URL;
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const viewerIds = await loadWarmViewerIds(supabase);
    const anonymousPage = await loadHomeFeedPage(supabase, {
      limit: HOME_FEED_WARM_LIMIT,
      viewerId: null,
      feedSeed: "peuin",
      forceRefresh: true,
      cacheTtlSeconds: HOME_FEED_CACHE_TTL_SECONDS,
    });
    let warmedViewers = 0;
    for (const viewerId of viewerIds) {
      await loadHomeFeedPage(supabase, {
        limit: HOME_FEED_WARM_LIMIT,
        viewerId,
        feedSeed: viewerId,
        forceRefresh: true,
        cacheTtlSeconds: HOME_FEED_CACHE_TTL_SECONDS,
      });
      warmedViewers += 1;
    }

    return jsonResponse({
      ok: true,
      warmed: true,
      viewer: "anonymous",
      postCount: anonymousPage.posts.length,
      warmedViewers,
      redisConfigured: isRedisConfigured(),
      cacheTtlSeconds: HOME_FEED_CACHE_TTL_SECONDS,
    }, 200);
  } catch (error) {
    console.error("home-feed-warm error", error);
    const message = error instanceof Error ? error.message : "Warm failed";
    const status = message.toLowerCase().includes("unauthorized") ? 401 : 500;
    return jsonResponse({ error: message }, status);
  }

}
