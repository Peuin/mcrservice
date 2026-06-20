// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../../config/env.js";
import { readHeader, type PortedRequest } from "../../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[food-catalog] background task failed", error));
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const defaultFoodCatalogBucket = "food-catalog";



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

async function fetchFoodCatalog(
  supabase: ReturnType<typeof createRequestClient>,
) {
  const { user } = await requireUser(supabase);
  const catalogRows = await selectMany(
    supabase
      .schema("core")
      .from("food_catalog")
      .select(
        "id,owner_user_id,slug,name_vi,name_en,icon_bucket,icon_path,icon_url,sort_order,created_at",
      )
      .eq("is_active", true)
      .order("owner_user_id", { ascending: true, nullsFirst: true })
      .order("sort_order", { ascending: true })
      .order("name_vi", { ascending: true }),
  );
  const markRows = await selectMany(
    supabase
      .schema("core")
      .from("user_food_catalog_marks")
      .select("food_catalog_id,is_marked")
      .eq("user_id", user.id),
  );
  const marks = new Map(
    markRows.map((row) => [
      stringValue(row.food_catalog_id),
      booleanValue(row.is_marked),
    ]),
  );

  return {
    items: catalogRows.map((row) => serializeCatalogRow(supabase, row, marks)),
  };
}

async function mutateFoodCatalog(
  supabase: ReturnType<typeof createRequestClient>,
  request: PortedRequest,
) {
  const { user } = await requireUser(supabase);
  const body = (await request.json().catch(() => ({}))) as Json;
  const action = stringValue(body.action).toLowerCase();

  if (action === "create") {
    return createFoodCatalogItem(supabase, user.id, body);
  }

  if (action === "set_mark") {
    return setFoodCatalogMark(supabase, user.id, body);
  }

  throw new Error("Action Food Catalog không hợp lệ.");
}

async function createFoodCatalogItem(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
  body: Json,
) {
  const nameVi = stringValue(body.nameVi ?? body.name_vi);
  const nameEn = stringValue(body.nameEn ?? body.name_en);
  const iconPath = stringValue(body.iconPath ?? body.icon_path);
  const iconUrl = stringValue(body.iconUrl ?? body.icon_url);
  const iconBucket =
    stringValue(body.iconBucket ?? body.icon_bucket) ||
    defaultFoodCatalogBucket;
  const slug = slugify(stringValue(body.slug) || nameEn || nameVi);

  if (!nameVi || !nameEn) {
    throw new Error("Nhập tên món tiếng Việt và tiếng Anh trước đã nha.");
  }
  if (!iconPath && !iconUrl) {
    throw new Error("Food Catalog cần icon_path hoặc icon_url từ S3.");
  }

  const { data, error } = await supabase
    .schema("core")
    .from("food_catalog")
    .insert({
      owner_user_id: userId,
      slug,
      name_vi: nameVi,
      name_en: nameEn,
      icon_bucket: iconBucket,
      icon_path: iconPath || null,
      icon_url: iconUrl || null,
      sort_order: 1000,
    })
    .select(
      "id,owner_user_id,slug,name_vi,name_en,icon_bucket,icon_path,icon_url,sort_order,created_at",
    )
    .single();
  if (error) throw error;

  await setFoodCatalogMark(supabase, userId, {
    action: "set_mark",
    foodCatalogId: stringValue((data as Json).id),
    isMarked: true,
  });

  return {
    item: serializeCatalogRow(
      supabase,
      data as Json,
      new Map([[stringValue((data as Json).id), true]]),
    ),
  };
}

async function setFoodCatalogMark(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
  body: Json,
) {
  const foodCatalogId = stringValue(body.foodCatalogId ?? body.food_catalog_id);
  const isMarked = booleanValue(body.isMarked ?? body.is_marked);

  if (!foodCatalogId) {
    throw new Error("Thiếu foodCatalogId để đánh dấu món.");
  }

  const { error } = await supabase
    .schema("core")
    .from("user_food_catalog_marks")
    .upsert({
      user_id: userId,
      food_catalog_id: foodCatalogId,
      is_marked: isMarked,
    }, { onConflict: "user_id,food_catalog_id" });
  if (error) throw error;

  return { food_catalog_id: foodCatalogId, is_marked: isMarked };
}

function serializeCatalogRow(
  supabase: ReturnType<typeof createRequestClient>,
  row: Json,
  marks: Map<string, boolean>,
) {
  const id = stringValue(row.id);
  const ownerUserId = stringValue(row.owner_user_id);
  return {
    id,
    slug: stringValue(row.slug),
    name_vi: stringValue(row.name_vi),
    name_en: stringValue(row.name_en),
    icon_url: publicStorageUrl(
      supabase,
      stringValue(row.icon_bucket) || defaultFoodCatalogBucket,
      stringValue(row.icon_url) || stringValue(row.icon_path),
    ),
    icon_path: stringValue(row.icon_path),
    icon_bucket: stringValue(row.icon_bucket),
    is_shared: ownerUserId.length === 0,
    is_marked: marks.get(id) ?? false,
    sort_order: numberValue(row.sort_order),
    created_at: stringValue(row.created_at),
  };
}

async function requireUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Bạn cần đăng nhập để dùng Food Catalog.");
  }
  return { user: data.user };
}

async function selectMany(query: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data as Json[] : [];
}

function publicStorageUrl(
  supabase: ReturnType<typeof createRequestClient>,
  bucket: string,
  pathOrUrl: string,
) {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const cleanPath = pathOrUrl.startsWith("/") ? pathOrUrl.slice(1) : pathOrUrl;
  return supabase.storage.from(bucket).getPublicUrl(cleanPath).data.publicUrl;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || randomUUID();
}

function stringValue(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : value == null
    ? ""
    : String(value);
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
  return "Có lỗi xảy ra khi xử lý Food Catalog.";
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error as Json;
}

export async function handleFoodCatalog(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createRequestClient(request);

    if (request.method === "GET") {
      return jsonResponse(await fetchFoodCatalog(supabase), 200);
    }

    if (request.method === "POST") {
      return jsonResponse(await mutateFoodCatalog(supabase, request), 200);
    }

    return jsonResponse(
      { error: "Không tìm thấy endpoint Food Catalog." },
      404,
    );
  } catch (error) {
    console.error("food-catalog error", error);
    return jsonResponse(
      { error: errorMessage(error), details: errorDetails(error) },
      400,
    );
  }

}
