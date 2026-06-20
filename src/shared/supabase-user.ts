import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { env } from "../config/env.js";

export function createUserSupabaseClient(authorization?: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: authorization ?? ""
      }
    }
  });
}

export async function requireUser(client: SupabaseClient, message = "Authentication required."): Promise<User> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error(message);
  return data.user;
}
