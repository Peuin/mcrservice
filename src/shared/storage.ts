import type { SupabaseClient } from "@supabase/supabase-js";
import { stringValue } from "./helpers.js";

export const AVATAR_STORAGE_BUCKET = "avata";

export function publicStorageUrl(supabase: SupabaseClient, bucket: string, path: string): string | null {
  const normalized = stringValue(path).trim();
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  const cleanPath = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  const { data } = supabase.storage.from(bucket).getPublicUrl(cleanPath);
  return data.publicUrl;
}

export function avatarPublicUrl(supabase: SupabaseClient, path: string): string | null {
  return publicStorageUrl(supabase, AVATAR_STORAGE_BUCKET, path);
}
