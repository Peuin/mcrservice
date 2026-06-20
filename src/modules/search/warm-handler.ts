// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[app-search-warm] background task failed", error));
}


const SEARCH_CACHE_TTL_SECONDS = 300;
const DEFAULT_WARM_LIMIT = 8;
const DEFAULT_POSTS_LIMIT = 20;
const DEFAULT_VECTOR_BUCKET = "search";
const DEFAULT_VECTOR_DIMENSION = 1536;
const DEFAULT_VECTOR_DISTANCE_METRIC = "cosine";
const DEFAULT_VECTOR_DATA_TYPE = "float32";
const DEFAULT_VECTOR_INDEXES = [
  "profiles-search",
  "places-search",
  "foods-search",
  "posts-search",
];
const DEFAULT_WARM_QUERIES = [
  "phở",
  "bún",
  "cơm",
  "bánh",
  "cafe",
  "trà",
  "pizza",
  "gà",
];

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

  const cronSecret = env.APP_SEARCH_WARM_SECRET;
  const providedSecret = readHeader(request.headers, "x-cron-secret") ?? "";
  if (cronSecret && providedSecret === cronSecret) {
    return;
  }

  throw new Error("Unauthorized warm request");
}

function readWarmQueries() {
  const raw = env.APP_SEARCH_WARM_QUERIES;
  const source = raw && raw.trim() ? raw : DEFAULT_WARM_QUERIES.join(",");
  const queries = source
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return queries.length > 0 ? queries : DEFAULT_WARM_QUERIES;
}

async function ensureSearchVectorIndexes(supabase: SupabaseClient) {
  const vectorStorage = (supabase.storage as unknown as VectorStorageRoot)
    .vectors;
  if (!vectorStorage) {
    return {
      enabled: false,
      reason: "supabase-js runtime has no storage.vectors",
    };
  }

  const bucketName = stringValue(env.SEARCH_VECTOR_BUCKET) ||
    DEFAULT_VECTOR_BUCKET;
  const dimension = clampNumber(
    Number(env.SEARCH_VECTOR_DIMENSION ?? DEFAULT_VECTOR_DIMENSION),
    1,
    4096,
  );
  const distanceMetric =
    stringValue(env.SEARCH_VECTOR_DISTANCE_METRIC) ||
    DEFAULT_VECTOR_DISTANCE_METRIC;
  const indexNames = readVectorIndexNames();

  const bucketStatus = await ensureVectorBucket(vectorStorage, bucketName);
  const bucket = vectorStorage.from(bucketName);
  const existing = await listVectorIndexes(bucket);
  const existingNames = new Set(existing.map((item) => item.name));
  const indexes = [];

  for (const indexName of indexNames) {
    if (existingNames.has(indexName)) {
      indexes.push({ name: indexName, status: "exists" });
      continue;
    }

    const { error } = await bucket.createIndex({
      indexName,
      dataType: DEFAULT_VECTOR_DATA_TYPE,
      dimension,
      distanceMetric,
    });
    if (error) {
      throw new Error(
        `Không tạo được vector index ${indexName}: ${errorMessage(error)}`,
      );
    }
    indexes.push({ name: indexName, status: "created" });
  }

  return {
    enabled: true,
    bucket: { name: bucketName, status: bucketStatus },
    indexes,
    dimension,
    distanceMetric,
    dataType: DEFAULT_VECTOR_DATA_TYPE,
  };
}

async function ensureVectorBucket(
  vectorStorage: VectorStorage,
  bucketName: string,
) {
  const bucketList = await vectorStorage.listBuckets?.();
  if (bucketList?.error) {
    throw bucketList.error;
  }
  const exists = Array.isArray(bucketList?.data) &&
    bucketList.data.some((bucket) => stringValue(bucket.name) === bucketName);
  if (exists) return "exists";

  const created = await vectorStorage.createBucket(bucketName);
  if (created.error) {
    const message = errorMessage(created.error);
    if (message.toLowerCase().includes("already")) return "exists";
    throw created.error;
  }
  return "created";
}

async function listVectorIndexes(bucket: VectorBucket) {
  const { data, error } = await bucket.listIndexes();
  if (error) throw error;

  return (Array.isArray(data) ? data : [])
    .map((item) => ({ name: stringValue(item.name) }))
    .filter((item) => item.name.length > 0);
}

function readVectorIndexNames() {
  const raw = stringValue(env.SEARCH_VECTOR_INDEXES);
  if (!raw) return DEFAULT_VECTOR_INDEXES;
  const names = raw.split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return names.length > 0 ? names : DEFAULT_VECTOR_INDEXES;
}

async function warmUsers(
  supabase: SupabaseClient,
  normalizedQuery: string,
  query: string,
  limit: number,
) {
  const cacheKey = buildUsersCacheKey(normalizedQuery, limit);
  const { data, error } = await supabase.rpc("search_users", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;

  await redisSet(cacheKey, data as Json[] | null ?? [], SEARCH_CACHE_TTL_SECONDS);
}

async function warmPlaces(
  supabase: SupabaseClient,
  normalizedQuery: string,
  query: string,
  limit: number,
) {
  const cacheKey = buildPlacesCacheKey(normalizedQuery, limit);
  const { data, error } = await supabase.rpc("search_places", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;

  await redisSet(cacheKey, data as Json[] | null ?? [], SEARCH_CACHE_TTL_SECONDS);
}

async function warmFoods(
  supabase: SupabaseClient,
  normalizedQuery: string,
  query: string,
  limit: number,
) {
  const cacheKey = buildFoodsCacheKey(normalizedQuery, limit);
  const { data, error } = await supabase.rpc("search_foods", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;

  await redisSet(cacheKey, data as Json[] | null ?? [], SEARCH_CACHE_TTL_SECONDS);
}

async function warmPostsByPlace(
  supabase: SupabaseClient,
  placeId: string,
  limit: number,
) {
  const cacheKey = buildPostsByPlaceCacheKey(placeId, limit, null);
  const { data, error } = await supabase.rpc("search_posts_by_place", {
    p_place_id: placeId,
    p_limit: limit,
    p_viewer_id: null,
  });
  if (error) throw error;

  await redisSet(cacheKey, data as Json[] | null ?? [], SEARCH_CACHE_TTL_SECONDS);
}

async function loadTopPlaceIds(supabase: SupabaseClient, limit: number) {
  const { data, error } = await supabase.rpc("search_top_place_ids", {
    p_limit: limit,
  });
  if (error) {
    console.warn("search_top_place_ids skipped", error);
    return [] as string[];
  }

  return (data as Json[] | null ?? [])
    .map((row) => stringValue(row.id))
    .filter((id) => id.length > 0);
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
    console.warn("app-search-warm redis set skipped", error);
  }
}

function isRedisConfigured() {
  return Boolean(
    env.UPSTASH_REDIS_REST_URL &&
      env.UPSTASH_REDIS_REST_TOKEN,
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  const record = error as { message?: unknown; error?: unknown };
  return stringValue(record?.message ?? record?.error) || "Unknown error";
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

type VectorStorageRoot = {
  vectors?: VectorStorage;
};

type VectorStorage = {
  createBucket: (bucketName: string) => Promise<VectorResult<unknown>>;
  listBuckets?: () => Promise<VectorResult<Array<{ name?: unknown }>>>;
  from: (bucketName: string) => VectorBucket;
};

type VectorBucket = {
  createIndex: (options: {
    indexName: string;
    dataType: string;
    dimension: number;
    distanceMetric: string;
  }) => Promise<VectorResult<unknown>>;
  listIndexes: () => Promise<VectorResult<Array<{ name?: unknown }>>>;
};

type VectorResult<T> = {
  data?: T | null;
  error?: unknown;
};

export async function handleAppSearchWarm(request: PortedRequest): Promise<Response> {

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
    const vectorIndexes = await ensureSearchVectorIndexes(supabase);
    const queries = readWarmQueries();
    const limit = clampNumber(
      Number(env.APP_SEARCH_WARM_LIMIT ?? DEFAULT_WARM_LIMIT),
      1,
      20,
    );
    const postsLimit = clampNumber(
      Number(env.APP_SEARCH_WARM_POSTS_LIMIT ?? DEFAULT_POSTS_LIMIT),
      1,
      50,
    );

    let warmedQueries = 0;
    for (const query of queries) {
      const normalizedQuery = normalizeSearchKey(query);
      await Promise.all([
        warmUsers(supabase, normalizedQuery, query, limit),
        warmPlaces(supabase, normalizedQuery, query, limit),
        warmFoods(supabase, normalizedQuery, query, limit),
      ]);
      warmedQueries += 1;
    }

    const topPlaceIds = await loadTopPlaceIds(supabase, 10);
    let warmedPlaces = 0;
    for (const placeId of topPlaceIds) {
      await warmPostsByPlace(supabase, placeId, postsLimit);
      warmedPlaces += 1;
    }

    return jsonResponse({
      ok: true,
      warmed: true,
      warmedQueries,
      warmedTopPlaces: warmedPlaces,
      vectorIndexes,
      redisConfigured: isRedisConfigured(),
      cacheTtlSeconds: SEARCH_CACHE_TTL_SECONDS,
      queries,
    }, 200);
  } catch (error) {
    console.error("app-search-warm error", error);
    const message = error instanceof Error ? error.message : "Warm failed";
    const status = message.toLowerCase().includes("unauthorized") ? 401 : 500;
    return jsonResponse({ error: message }, status);
  }

}
