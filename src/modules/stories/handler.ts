// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { createHandlerSupabaseClient } from "../../shared/handler-supabase.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[stories] background task failed", error));
}


type BunnyStoryConfig = {
  storageZone: string;
  storageHost: string;
  accessKey: string;
  cdnBaseUrl: string;
  storagePrefix: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};



function createRequestClient(request: PortedRequest) {
  return createHandlerSupabaseClient(request);
}

async function requireUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Bạn cần đăng nhập để dùng stories.");
  return { user: data.user };
}

function mapStoryRows(
  supabase: ReturnType<typeof createRequestClient>,
  value: unknown,
  bunny: BunnyStoryConfig,
) {
  const rows = arrayValue(value).map(objectValue);
  return rows.map((row) => {
    const mediaPath = stringValue(row.media_path);
    const mediaUrl = storyMediaUrl(bunny, mediaPath);
    return {
      id: stringValue(row.id),
      user_id: stringValue(row.user_id),
      media_path: mediaPath,
      media_url: mediaUrl,
      fallback_media_url: "",
      media_type: stringValue(row.media_type) || "image",
      visibility: stringValue(row.visibility) || "friends",
      created_at: stringValue(row.created_at),
      expires_at: stringValue(row.expires_at),
      author_name: stringValue(row.author_name),
      author_username: stringValue(row.author_username),
      author_avatar_url:
        avatarPublicUrl(supabase, {
          avatar_url: stringValue(row.author_avatar_url),
        }) ?? "",
      text_overlay: row.text_overlay ?? null,
      caption: stringValue(row.caption) || null,
    };
  });
}

function storyMediaUrl(bunny: BunnyStoryConfig, mediaPath: string) {
  if (!mediaPath) return "";
  if (/^https?:\/\//i.test(mediaPath)) return mediaPath;
  return `${bunny.cdnBaseUrl}/${encodePath(bunnyStoryPath(bunny, mediaPath))}`;
}

async function uploadStoryToBunny(
  bunny: BunnyStoryConfig,
  mediaPath: string,
  mediaBytes: Uint8Array,
  contentType: string,
) {
  if (!mediaPath || mediaBytes.length === 0) {
    throw new Error("Ảnh story không hợp lệ.");
  }

  const bunnyPath = bunnyStoryPath(bunny, mediaPath);
  const uploadUrl =
    `https://${bunny.storageHost}/${encodeURIComponent(bunny.storageZone)}/${encodePath(bunnyPath)}`;

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      AccessKey: bunny.accessKey,
      "Content-Type": contentType,
    },
    body: mediaBytes,
  });
  if (!response.ok) {
    throw new Error(
      `Không upload được story lên Bunny Storage: HTTP ${response.status}`,
    );
  }
}

async function deleteStoryFromBunny(
  bunny: BunnyStoryConfig,
  mediaPath: string,
) {
  if (!mediaPath) return;

  const bunnyPath = bunnyStoryPath(bunny, mediaPath);
  const deleteUrl =
    `https://${bunny.storageHost}/${encodeURIComponent(bunny.storageZone)}/${encodePath(bunnyPath)}`;

  const response = await fetch(deleteUrl, {
    method: "DELETE",
    headers: { AccessKey: bunny.accessKey },
  });
  if (!response.ok) {
    console.warn(`Story Bunny cleanup skipped: HTTP ${response.status}`);
  }
}

function bunnyStoryPath(bunny: BunnyStoryConfig, mediaPath: string) {
  return [bunny.storagePrefix, mediaPath].filter(Boolean).join("/");
}

function requireBunnyStoryConfig(): BunnyStoryConfig {
  const storageZone = stringValue(env.BUNNY_STORAGE_ZONE);
  const accessKey = stringValue(
    env.BUNNY_STORAGE_API_KEY || env.BUNNY_API_KEY,
  );
  const cdnBaseUrl = normalizeBaseUrl(
    env.BUNNY_STORY_CDN_BASE_URL,
  );
  const storageHost = stringValue(env.BUNNY_STORAGE_HOST) ||
    "storage.bunnycdn.com";
  const storagePrefix = normalizeStoragePath(
    stringValue(env.BUNNY_STORY_STORAGE_PREFIX) || "stories",
  );

  const missing = [
    !storageZone ? "BUNNY_STORAGE_ZONE" : "",
    !accessKey ? "BUNNY_STORAGE_API_KEY" : "",
    !cdnBaseUrl ? "BUNNY_STORY_CDN_BASE_URL" : "",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Thiếu cấu hình Bunny: ${missing.join(", ")}.`);
  }

  return {
    storageZone,
    storageHost,
    accessKey,
    cdnBaseUrl,
    storagePrefix,
  };
}

function normalizeBaseUrl(value: unknown) {
  return stringValue(value).replace(/\/+$/, "");
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function normalizeStoragePath(path: string) {
  return path.replace(/^\/+/, "").trim();
}

function decodeBase64Bytes(value: string) {
  const clean = value.includes(",") ? value.split(",").pop() ?? "" : value;
  try {
    return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
  } catch (_) {
    throw new Error("Ảnh story base64 không hợp lệ.");
  }
}

function normalizeImageContentType(value: unknown) {
  const contentType = stringValue(value).toLowerCase();
  if (
    ["image/jpeg", "image/png", "image/webp", "image/heic"].includes(
      contentType,
    )
  ) {
    return contentType;
  }
  return "image/jpeg";
}

function extensionForContentType(contentType: string) {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    default:
      return "jpg";
  }
}

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function enrichStoryAuthor(
  supabase: ReturnType<typeof createRequestClient>,
  row: Json,
  profile?: Json | null,
  metadata?: Json | null,
) {
  return {
    ...row,
    author_name: profileDisplayName(profile, metadata) || "Bạn ăn ngon",
    author_username: stringValue(profile?.username) ||
      stringValue(metadata?.username),
    author_avatar_url: avatarPublicUrl(supabase, profile, metadata) ?? "",
  };
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
  return typeof value === "string"
    ? value.trim()
    : value == null
    ? ""
    : String(value);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function objectValue(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Json
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  const item = objectValue(error);
  const message = stringValue(item.message);
  return message || "Có lỗi xảy ra với stories.";
}

export async function handleStories(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createRequestClient(request);
    const { user } = await requireUser(supabase);
    const url = new URL(request.url);
    const bunny = requireBunnyStoryConfig();

    if (request.method === "GET") {
      const isArchive = url.searchParams.get("archive") === "true";
      if (isArchive) {
        const { data, error } = await supabase
          .schema("social")
          .from("stories")
          .select(
            "id,user_id,media_path,media_type,visibility,created_at,expires_at,text_overlay,caption",
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id,display_name,username,avatar_url")
          .eq("id", user.id)
          .maybeSingle();
        if (profileError) {
          console.warn("archive profile skipped:", profileError.message);
        }
        const enriched = arrayValue(data).map((row) =>
          enrichStoryAuthor(
            supabase,
            objectValue(row),
            profile,
            user.user_metadata,
          )
        );
        return jsonResponse({
          success: true,
          stories: mapStoryRows(supabase, enriched, bunny),
        }, 200);
      }

      const limit = clampNumber(
        Number(url.searchParams.get("limit") ?? 40),
        1,
        80,
      );
      const { data, error } = await supabase.schema("social").rpc(
        "list_visible_stories",
        { p_limit: limit },
      );
      if (error) throw error;
      return jsonResponse({
        success: true,
        stories: mapStoryRows(supabase, data, bunny),
      }, 200);
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({})) as Json;
      const mediaBase64 = stringValue(
        body.media_base64 ?? body.mediaBase64 ?? body.image_base64 ??
          body.imageBase64,
      );
      if (!mediaBase64) {
        return jsonResponse({ error: "Thiếu ảnh story." }, 400);
      }

      const mediaBytes = decodeBase64Bytes(mediaBase64);
      const contentType = normalizeImageContentType(
        body.content_type ?? body.contentType ?? body.mime_type ??
          body.mimeType,
      );
      const extension = extensionForContentType(contentType);
      const mediaPath = `${user.id}/${Date.now()}-${randomUUID()}.${extension}`;
      const textOverlay = body.textOverlay ?? body.text_overlay ?? null;
      const caption = stringValue(body.caption);

      await uploadStoryToBunny(bunny, mediaPath, mediaBytes, contentType);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .schema("social")
        .from("stories")
        .insert({
          user_id: user.id,
          media_path: mediaPath,
          media_type: "image",
          visibility: "friends",
          text_overlay: textOverlay,
          caption: caption || null,
          expires_at: expiresAt,
        })
        .select(
          "id,user_id,media_path,media_type,visibility,created_at,expires_at,text_overlay,caption",
        )
        .single();
      if (error) {
        await deleteStoryFromBunny(bunny, mediaPath);
        throw error;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id,display_name,username,avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) {
        console.warn("create story profile skipped:", profileError.message);
      }
      const enriched = enrichStoryAuthor(
        supabase,
        objectValue(data),
        profile,
        user.user_metadata,
      );
      const rows = mapStoryRows(supabase, [enriched], bunny);
      return jsonResponse({ success: true, story: rows[0] ?? null }, 201);
    }

    return jsonResponse({ error: "stories chỉ hỗ trợ GET hoặc POST." }, 405);
  } catch (error) {
    console.error("stories error", error);
    return jsonResponse({ error: errorMessage(error) }, 400);
  }

}
