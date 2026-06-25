import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { env } from "../config/env.js";

export function extractAccessToken(authorization?: string): string | null {
  const value = authorization?.trim();
  if (!value) return null;

  if (value.toLowerCase().startsWith("bearer ")) {
    const token = value.slice(7).trim();
    return token || null;
  }

  return value;
}

export function createUserSupabaseClient(accessToken?: string | null): SupabaseClient {
  const token = accessToken?.trim() || null;
  const headers: Record<string, string> = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers }
  });
}

export async function resolveViewer(authorization?: string): Promise<{
  client: SupabaseClient;
  user: User | null;
  accessToken: string | null;
}> {
  const accessToken = extractAccessToken(authorization);
  if (!accessToken) {
    return { client: createUserSupabaseClient(), user: null, accessToken: null };
  }

  const client = createUserSupabaseClient(accessToken);
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    return { client: createUserSupabaseClient(), user: null, accessToken: null };
  }

  return { client, user: data.user, accessToken };
}

export async function requireUserFromAuthorization(
  authorization: string | undefined,
  message = "Authentication required."
): Promise<{ client: SupabaseClient; user: User; accessToken: string }> {
  const { client, user, accessToken } = await resolveViewer(authorization);
  if (!user || !accessToken) {
    throw new Error(message);
  }
  return { client, user, accessToken };
}

export async function requireUser(client: SupabaseClient, message = "Authentication required."): Promise<User> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error(message);
  return data.user;
}
