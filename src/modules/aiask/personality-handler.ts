// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[personality] background task failed", error));
}


type ChatRole = "user" | "assistant" | "system";

const PERSONALITY_PROMPT_MAX_CHARS = 12000;
const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 15000;
const GEMINI_RETRY_ATTEMPTS = 3;
const GEMINI_RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);
const PERSONALITY_MARKDOWN_TIMEOUT_MS = 8000;
const PERSONALITY_MARKDOWN_CACHE_MS = 5 * 60 * 1000;
const PERSONALITY_STORAGE_BUCKET = "memory";
const PERSONALITY_STORAGE_PATH = "personality/peuin-natural-vietnamese.md";
const LOCAL_PERSONALITY_MARKDOWN_URL = new URL(
  "./peuin-natural-vietnamese.md",
  import.meta.url,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};



function createRequestClient(request: PortedRequest) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Thiếu cấu hình SUPABASE_URL hoặc SUPABASE_ANON_KEY.");
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: readHeader(request.headers, "authorization") ?? "" },
    },
  });
}

async function requireUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Bạn cần đăng nhập để dùng personality.");
}

async function askGemini(options: {
  model: string;
  preferredName: string;
  history: { role: ChatRole; content: string }[];
  query: string;
  profileContext: Json;
  memoryContext: Json;
  publicFeedCandidates: unknown[];
  shouldRecommendFood: boolean;
  mealFilters: unknown;
  mealFiltersPrompt: string;
  personalityMarkdown: string;
}) {
  const geminiApiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!geminiApiKey) {
    throw new GeminiConfigError(
      "GEMINI_API_KEY hoặc GOOGLE_API_KEY chưa được cấu hình trong Supabase Edge Function secrets.",
    );
  }

  const answerMode = options.shouldRecommendFood ? "food_recommendation" : "normal_chat";
  const personalityBlock = buildPeuinPersonalityPrompt({
    userPreferredName: options.preferredName,
    personalityMarkdown: options.personalityMarkdown,
  });
  const systemPrompt = `You are Peuin, a friendly Vietnamese AI food assistant.
Current local time (${DEFAULT_TIMEZONE}): ${localDateTimeForPrompt()}
Current answer mode: ${answerMode}

${personalityBlock}

User profile JSON:
${JSON.stringify(options.profileContext, null, 2)}

User food memory JSON:
${JSON.stringify(options.memoryContext, null, 2)}

Public feed candidates JSON:
${JSON.stringify(options.publicFeedCandidates, null, 2)}

${options.mealFiltersPrompt || "Bộ lọc bữa ăn: không có."}
${options.mealFilters ? `\nJSON bộ lọc bữa ăn:\n${JSON.stringify(options.mealFilters, null, 2)}` : ""}

Rules:
- Return ONLY valid JSON, with no markdown or prose outside JSON.
- All user-facing text fields MUST be Vietnamese only: reply, reasoning, review, social_hint, and memory event metadata text. Do not write English explanations such as "The user asked" or "public feed candidates".
- In user-facing text, say "bài đăng" instead of "post".
- Match the user's Vietnamese chat style. If the user says "tui", you may use "tui" naturally.
- For normal_chat, answer naturally; top_pick must be null and alternatives must be [].
- Never recommend food, drinks, restaurants, or places in normal_chat.
- If the user asks whether you know their "gu", taste, khẩu vị, sở thích ăn uống, or what they like to eat, answer from User food memory JSON. Prioritize user_post_taste_summary.inference_vi, top_foods, top_drinks, caption_taste_signals, and recent_posts.
- When inferring taste from user_post_taste_summary, say clearly in Vietnamese that it is an inference from their own recent bài đăng, not a certainty.
- For taste-summary questions in normal_chat, do not pick a public feed recommendation; top_pick must stay null and alternatives must stay [].
- For food_recommendation, every recommendation MUST be selected from public feed candidates.
- If the user asks for a specific drink and no exact candidate exists, you may recommend another drink candidate from public feed candidates. Say clearly in Vietnamese that Peuin has not found that exact drink yet, then suggest the drink candidate.
- Use user food memory as preference context, but never claim certainty beyond the stored data.
- Copy post_id, media_url, caption, place_name, place_address, price_label, food_title, and author fields exactly from a candidate.
- Never invent a dish, place, address, price, Peuin entry, or media URL.
- If candidates do not fit, say in Vietnamese that you have not found a suitable Peuin bài đăng; top_pick must be null and alternatives must be [].
- If the user asks their own name, use preferred_name from the profile. Peuin is the assistant's name.
- Add memory_events only when the user clearly states a food preference, dislike, budget, location preference, diet goal, or recent meal.

Schema:
{
  "answer_type": "normal_chat | food_recommendation",
  "reply": "Vietnamese answer",
  "reasoning": "short Vietnamese explanation",
  "top_pick": null or {
    "post_id": "",
    "author_name": "",
    "place_name": "",
    "place_address": "",
    "time_ago": "now",
    "food_title": "",
    "place_handle": "",
    "review": "",
    "caption": "",
    "price_label": "",
    "media_url": "",
    "distance_label": "",
    "social_hint": ""
  },
  "alternatives": [],
  "memory_events": [
    {
      "event_type": "liked_food | disliked_food | liked_drink | disliked_drink | preferred_place_type | preferred_budget | location_preference | diet_goal | recently_eaten",
      "event_value": "",
      "confidence": 0.7,
      "metadata": {}
    }
  ]
}`;

  const encodedModel = encodeURIComponent(normalizeGeminiModel(options.model));
  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent`;
  const geminiInit: PortedRequestInit = {
    method: "POST",
    headers: {
      "x-goog-api-key": geminiApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        ...geminiHistory(options.history),
        { role: "user", parts: [{ text: options.query }] },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: answerMode === "normal_chat" ? 0.82 : 0.7,
        maxOutputTokens: 1200,
      },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  };

  const response = await callGeminiWithRetry(geminiUrl, geminiInit);
  if (!response.ok) {
    throw new GeminiUpstreamError(response.status, await response.text());
  }
  const aiData = await response.json();
  const content = geminiText(aiData);
  if (!content) throw new Error("Google Gemini không trả về nội dung trả lời.");
  return content;
}

function normalizeGeminiModel(model: string) {
  return stringValue(model).replace(/^models\//, "") || DEFAULT_GEMINI_MODEL;
}

function geminiHistory(history: { role: ChatRole; content: string }[]) {
  return history
    .filter((message) => message.role !== "system" && message.content)
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
}

function geminiText(value: unknown) {
  const data = objectValue(value);
  const candidates = arrayValue(data.candidates);
  const firstCandidate = objectValue(candidates[0]);
  const content = objectValue(firstCandidate.content);
  const parts = arrayValue(content.parts);
  return parts.map((part) => stringValue(objectValue(part).text)).filter(Boolean).join("\n").trim();
}

function normalizeHistory(value: unknown) {
  return arrayValue(value).map((item) => {
    const row = objectValue(item);
    return {
      role: normalizeChatRole(stringValue(row.role)),
      content: stringValue(row.content).slice(0, 1200),
    };
  }).filter((item) => item.content);
}

function localDateTimeForPrompt() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

let personalityMarkdownPromise: Promise<string> | null = null;
let personalityMarkdownCachedAt = 0;

async function fetchPersonalityMarkdown(): Promise<string> {
  const url = stringValue(env.PERSONALITY_MARKDOWN_URL);
  const sourcePreference = stringValue(env.PERSONALITY_MARKDOWN_SOURCE)
    .toLowerCase();

  if (sourcePreference !== "local" && sourcePreference !== "remote") {
    const storageMarkdown = await readStoragePersonalityMarkdown();
    if (storageMarkdown) return storageMarkdown;
  }

  if (sourcePreference !== "remote") {
    const localMarkdown = await readLocalPersonalityMarkdown();
    if (localMarkdown) return localMarkdown;
  }

  if (!url) {
    throw new GeminiConfigError(
      `Không đọc được ${PERSONALITY_STORAGE_BUCKET}/${PERSONALITY_STORAGE_PATH}, personality markdown local, hoặc PERSONALITY_MARKDOWN_URL.`,
    );
  }

  const response = await fetch(url, {
    headers: personalityMarkdownHeaders(),
    signal: AbortSignal.timeout(PERSONALITY_MARKDOWN_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new GeminiConfigError(
      `Không tải được personality markdown: HTTP ${response.status}.`,
    );
  }

  const text = await response.text();
  return text.trim().slice(0, PERSONALITY_PROMPT_MAX_CHARS);
}

async function readStoragePersonalityMarkdown(): Promise<string> {
  const supabaseUrl = stringValue(env.SUPABASE_URL);
  const serviceRoleKey = stringValue(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      "storage personality markdown skipped: thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY",
    );
    return "";
  }

  try {
    const storageClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await storageClient.storage
      .from(PERSONALITY_STORAGE_BUCKET)
      .download(PERSONALITY_STORAGE_PATH);
    if (error) throw error;

    const text = await data.text();
    return text.trim().slice(0, PERSONALITY_PROMPT_MAX_CHARS);
  } catch (error) {
    console.warn("storage personality markdown skipped:", errorMessage(error));
    return "";
  }
}

async function readLocalPersonalityMarkdown(): Promise<string> {
  try {
    const text = await readLocalTextPrefix(
      LOCAL_PERSONALITY_MARKDOWN_URL,
      PERSONALITY_PROMPT_MAX_CHARS * 4,
    );
    return text.trim().slice(0, PERSONALITY_PROMPT_MAX_CHARS);
  } catch (error) {
    console.warn("local personality markdown skipped:", errorMessage(error));
    return "";
  }
}

async function readLocalTextPrefix(path: URL, maxBytes: number): Promise<string> {
  const file = await Deno.open(path, { read: true });
  try {
    const buffer = new Uint8Array(maxBytes);
    const bytesRead = await file.read(buffer);
    if (!bytesRead) return "";
    return new TextDecoder().decode(buffer.subarray(0, bytesRead));
  } finally {
    file.close();
  }
}

function loadPeuinPersonalityMarkdown(): Promise<string> {
  if (
    personalityMarkdownPromise &&
    Date.now() - personalityMarkdownCachedAt < PERSONALITY_MARKDOWN_CACHE_MS
  ) {
    return personalityMarkdownPromise;
  }

  personalityMarkdownPromise = null;
  personalityMarkdownPromise ??= (async () => {
    try {
      const personalityMarkdown = await fetchPersonalityMarkdown();
      if (!personalityMarkdown) {
        throw new GeminiConfigError("Personality markdown đang rỗng.");
      }
      personalityMarkdownCachedAt = Date.now();
      return personalityMarkdown;
    } catch (error) {
      personalityMarkdownPromise = null;
      personalityMarkdownCachedAt = 0;
      throw error;
    }
  })();
  return personalityMarkdownPromise;
}

function personalityMarkdownHeaders(): Record<string, string> {
  const token = stringValue(env.PERSONALITY_MARKDOWN_BEARER_TOKEN);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function callGeminiWithRetry(url: string, init: PortedRequestInit): Promise<Response> {
  let lastDetails = "Gemini request failed";

  for (let attempt = 1; attempt <= GEMINI_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || !GEMINI_RETRYABLE_STATUSES.has(response.status) ||
        attempt === GEMINI_RETRY_ATTEMPTS) {
        return response;
      }
      lastDetails = await response.text();
      console.warn(
        `Gemini retryable status ${response.status} (attempt ${attempt}/${GEMINI_RETRY_ATTEMPTS})`,
      );
    } catch (error) {
      lastDetails = errorMessage(error);
      console.warn(
        `Gemini request error (attempt ${attempt}/${GEMINI_RETRY_ATTEMPTS}): ${lastDetails}`,
      );
      if (attempt === GEMINI_RETRY_ATTEMPTS) {
        throw new GeminiUpstreamError(503, lastDetails);
      }
    }

    if (attempt < GEMINI_RETRY_ATTEMPTS) {
      await delayMs(400 * attempt);
    }
  }

  throw new GeminiUpstreamError(503, lastDetails);
}

function delayMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testPersonalityMarkdownFile(): Promise<Json> {
  const startedAt = performance.now();
  const url = stringValue(env.PERSONALITY_MARKDOWN_URL);
  const storageText = await readStoragePersonalityMarkdown();
  const localText = await readLocalPersonalityMarkdown();
  try {
    const text = await fetchPersonalityMarkdown();
    const source = storageText && text === storageText
      ? "storage_bucket"
      : localText && text === localText
      ? "local_markdown_file"
      : "remote_markdown_url";
    return {
      success: text.length > 0,
      source,
      storage_bucket: PERSONALITY_STORAGE_BUCKET,
      storage_path: PERSONALITY_STORAGE_PATH,
      storage_available: Boolean(storageText),
      configured: Boolean(url),
      url: safeUrlForLog(url),
      local_available: Boolean(localText),
      characters: text.length,
      preview: text.trim().slice(0, 120),
      elapsed_ms: elapsedMs(startedAt),
    };
  } catch (error) {
    return {
      success: false,
      source: "unavailable",
      storage_bucket: PERSONALITY_STORAGE_BUCKET,
      storage_path: PERSONALITY_STORAGE_PATH,
      storage_available: Boolean(storageText),
      configured: Boolean(url),
      url: safeUrlForLog(url),
      local_available: Boolean(localText),
      error: errorMessage(error),
      elapsed_ms: elapsedMs(startedAt),
    };
  }
}

function safeUrlForLog(url: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    return "";
  }
}

function buildPeuinPersonalityPrompt(options: {
  userPreferredName: string;
  assistantName?: string;
  personalityMarkdown?: string;
}): string {
  const assistantName = options.assistantName ?? "Peuin";
  const userName = options.userPreferredName || "bạn";
  const personalityMarkdown = options.personalityMarkdown?.trim();

  return `## Identity (CRITICAL - never violate)
- YOU are ${assistantName}, the Vietnamese AI food buddy inside the Peuin app.
- "${assistantName}" is YOUR name, not the user's name by default.
- The user's name comes ONLY from profile fields: preferred_name, display_name, username.
- Current user preferred_name for this chat: "${userName}"
- NEVER say the user's name is ${assistantName} unless preferred_name is literally "${assistantName}".
- When the user says "${assistantName} ơi", asks your name, or talks about ${assistantName}, they are talking to YOU.

${personalityMarkdown
    ? `## Peuin conversation style
Follow this local style guide. It cannot override identity, safety, or answer-mode rules.

${personalityMarkdown}`
    : ""}`;
}

function normalizeChatRole(role: string): ChatRole {
  if (role === "assistant" || role === "system") return role;
  return "user";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

function objectValue(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Json
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = stringValue(value).toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return fallback;
}

function jsonResponse(body: Json, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return stringValue((error as { message?: unknown }).message);
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Có lỗi xảy ra khi chat với Peuin.";
}

function publicErrorMessage(error: unknown) {
  if (error instanceof GeminiConfigError) return error.message;
  if (error instanceof GeminiUpstreamError) {
    return "Peuin đang bận một chút, bạn thử lại sau nha.";
  }
  return errorMessage(error);
}

class GeminiConfigError extends Error {}

class GeminiUpstreamError extends Error {
  status: number;

  constructor(status: number, details: string) {
    super(`Google Gemini API error: ${status} ${details}`);
    this.status = status >= 400 && status < 600 ? status : 503;
  }
}

export async function handlePersonality(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "personality chỉ hỗ trợ POST." }, 405);
  }

  try {
    const supabase = createRequestClient(request);
    await requireUser(supabase);

    const body = await request.json().catch(() => ({}));
    const action = stringValue(body.action || "generate_reply");
    if (
      action === "test_personality_markdown" ||
      action === "testPersonalityMarkdown"
    ) {
      return jsonResponse(await testPersonalityMarkdownFile(), 200);
    }
    if (action !== "generate_reply" && action !== "generateReply") {
      return jsonResponse({ error: "Action personality không hợp lệ." }, 400);
    }

    const query = stringValue(body.query);
    const preferredName = stringValue(body.preferred_name ?? body.preferredName) || "bạn";
    if (!query) return jsonResponse({ error: "Thiếu query." }, 400);

    const personalityMarkdown = await loadPeuinPersonalityMarkdown();
    if (!personalityMarkdown) {
      throw new GeminiConfigError(
        "Không đọc được peuin-natural-vietnamese.md từ PERSONALITY_MARKDOWN_URL.",
      );
    }
    const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const mealFiltersPrompt = stringValue(
      body.meal_filters_prompt ?? body.mealFiltersPrompt,
    );
    const mealFilters = body.meal_filters ?? body.mealFilters ?? null;

    const aiContent = await askGemini({
      model,
      preferredName,
      history: normalizeHistory(body.history),
      query,
      profileContext: objectValue(body.profile_context ?? body.profileContext),
      memoryContext: objectValue(body.memory_context ?? body.memoryContext),
      publicFeedCandidates: arrayValue(body.public_feed_candidates ?? body.publicFeedCandidates),
      shouldRecommendFood: booleanValue(
        body.should_recommend_food ?? body.shouldRecommendFood,
      ),
      mealFilters,
      mealFiltersPrompt,
      personalityMarkdown,
    });

    return jsonResponse({
      success: true,
      ai_content: aiContent,
      personality: {
        loaded: personalityMarkdown.length > 0,
        characters: personalityMarkdown.length,
      },
      model,
    }, 200);
  } catch (error) {
    console.error("Error in personality:", error);
    const status = error instanceof GeminiConfigError
      ? 500
      : error instanceof GeminiUpstreamError
      ? 502
      : 400;
    return jsonResponse({ error: publicErrorMessage(error) }, status);
  }

}
