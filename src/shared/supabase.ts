import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { safeSupabaseEndpointLabel, supabaseRestUrl } from "./supabase-url.js";

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "core" as const },
};

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, clientOptions);

function resolveServiceRoleKey(): string | undefined {
  const source = env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_SECRET_KEY";
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (!key) return undefined;
  if (!key.startsWith("eyJ")) {
    console.warn(
      "[supabase] SUPABASE_SERVICE_ROLE_KEY không có dạng JWT (eyJ...). " +
      "PostgREST thường trả 401 nếu dùng anon key hoặc sb_secret_ key.",
    );
  }
  console.info("[supabase] admin client configured", {
    url: safeSupabaseEndpointLabel("/rest/v1"),
    keySource: source,
  });
  return key;
}

// Chỉ dùng trong nghiệp vụ server nội bộ. Tuyệt đối không trả key này về client.
console.info("[supabase] REST endpoint", { url: supabaseRestUrl() });
const serviceRoleKey = resolveServiceRoleKey();
export const supabaseAdmin = serviceRoleKey
  ? createClient(env.SUPABASE_URL, serviceRoleKey, clientOptions)
  : undefined;

export function requireSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.");
  }
  return supabaseAdmin;
}
