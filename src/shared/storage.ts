import type { SupabaseClient } from "@supabase/supabase-js";
import { stringValue } from "./helpers.js";

export function publicStorageUrl(supabase: SupabaseClient, bucket: string, path: string): string | null {
  const normalized = stringValue(path).trim();
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  const { data } = supabase.storage.from(bucket).getPublicUrl(normalized);
  return data.publicUrl;
}
