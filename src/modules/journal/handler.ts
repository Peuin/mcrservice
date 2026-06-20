// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[journal] background task failed", error));
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};



async function readInput(request: PortedRequest): Promise<Json> {
  if (request.method === "GET") {
    return Object.fromEntries(new URL(request.url).searchParams.entries());
  }

  const body = await request.json().catch(() => ({}));
  return body && typeof body === "object" && !Array.isArray(body)
    ? body as Json
    : {};
}

function createRequestClient(request: PortedRequest) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Thiếu cấu hình SUPABASE_URL hoặc SUPABASE_ANON_KEY.");
  }

  const authorization = readHeader(request.headers, "authorization") ?? "";
  const authToken = authorization.replace(/^Bearer\s+/i, "").trim();
  const hasUserJwt = authToken.split(".").length === 3;

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: {
      headers: hasUserJwt ? { Authorization: authorization } : {},
    },
  });
}

function publicStorageUrl(
  supabase: ReturnType<typeof createRequestClient>,
  path: string,
) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const { data } = supabase.storage.from("post-media").getPublicUrl(path);
  return data.publicUrl;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(stringValue(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Không tải được journal.";
}

export async function handleJournal(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createRequestClient(request);
    const input = await readInput(request);
    const action = stringValue(input.action ?? input.type).trim().toLowerCase();
    const timezone = stringValue(input.timezone ?? input.timeZone) ||
      "Asia/Ho_Chi_Minh";

    if (request.method === "GET" || request.method === "POST") {
      if (action === "day" || input.day != null) {
        const day = stringValue(input.day).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          return jsonResponse({ error: "Thiếu ngày journal hợp lệ." }, 400);
        }

        const { data, error } = await supabase.schema("social").rpc(
          "journal_day_entries",
          {
            p_day: day,
            p_timezone: timezone,
          },
        );
        if (error) throw error;

        const entries = (Array.isArray(data) ? data as Json[] : []).map((row) => ({
          ...row,
          media_url: publicStorageUrl(supabase, stringValue(row.media_url)),
        }));
        return jsonResponse({ entries }, 200);
      }

      const year = numberValue(input.year ?? input.p_year);
      const month = numberValue(input.month ?? input.p_month);
      if (!year || !month || month < 1 || month > 12) {
        return jsonResponse({ error: "Thiếu tháng journal hợp lệ." }, 400);
      }

      const { data, error } = await supabase.schema("social").rpc(
        "journal_month_markers",
        {
          p_year: year,
          p_month: month,
          p_timezone: timezone,
        },
      );
      if (error) throw error;

      return jsonResponse({
        markers: Array.isArray(data) ? data : [],
      }, 200);
    }

    return jsonResponse({ error: "Không tìm thấy endpoint journal." }, 404);
  } catch (error) {
    console.error("journal error", error);
    return jsonResponse({ error: errorMessage(error) }, 400);
  }

}
