import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { readHeader, type PortedRequest } from "./handler-runtime.js";
import { publicAdmin, requireSupabaseAdmin, socialAdmin } from "./supabase.js";
import { extractAccessToken } from "./supabase-user.js";

const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/**
 * PostgREST client for ported handlers: DB via service role (no user JWT on REST),
 * identity via Auth API `getUser(accessToken)`.
 */
export type HandlerSupabaseClient = {
  schema: (schemaName: string) => ReturnType<typeof socialAdmin> | ReturnType<ReturnType<typeof requireSupabaseAdmin>["schema"]>;
  from: (table: string) => ReturnType<ReturnType<typeof publicAdmin>["from"]>;
  storage: SupabaseClient["storage"];
  auth: {
    getUser: () => ReturnType<typeof authClient.auth.getUser>;
  };
};

export function createHandlerSupabaseClient(request: PortedRequest): HandlerSupabaseClient {
  const token = extractAccessToken(readHeader(request.headers, "authorization") ?? undefined);
  const admin = requireSupabaseAdmin();

  return {
    schema(schemaName: string) {
      if (schemaName === "social") return socialAdmin();
      return admin.schema(schemaName as "core" | "public");
    },
    from(table: string) {
      return publicAdmin().from(table);
    },
    storage: admin.storage,
    auth: {
      getUser() {
        if (!token) {
          return authClient.auth.getUser("__missing__");
        }
        return authClient.auth.getUser(token);
      }
    }
  };
}
