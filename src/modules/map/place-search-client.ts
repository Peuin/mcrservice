import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

export function createPlaceSearchClient(request?: PortedRequest): SupabaseClient {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey =
    env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Thiếu SUPABASE_URL hoặc Supabase API key.");
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: request ? readHeader(request.headers, "authorization") : ""
      }
    }
  });
}
