import { env } from "../config/env.js";

function rootUrl() {
  return env.SUPABASE_URL.replace(/\/+$/, "");
}

export function supabaseRestUrl() {
  return `${rootUrl()}/rest/v1`;
}

export function supabaseStorageUrl() {
  return `${rootUrl()}/storage/v1`;
}

export function supabaseAuthUrl() {
  return `${rootUrl()}/auth/v1`;
}

export function safeSupabaseEndpointLabel(path = "/") {
  const url = new URL(path, rootUrl());
  return `${url.origin}${url.pathname}`;
}
