#!/usr/bin/env node
/**
 * Converts BE/functions edge function index.ts (Deno) into mcrservice module handlers.
 * Run from repo root: node BE/mcrservice/scripts/port-edge-functions.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const functionsDir = path.join(repoRoot, "BE/functions");
const modulesDir = path.join(repoRoot, "BE/mcrservice/src/modules");

/** Edge function folder name -> handler path under src/modules/ */
const HANDLER_TARGETS = {
  "app-feedback": "feedback/handler.ts",
  "app-search": "search/handler.ts",
  "app-search-warm": "search/warm-handler.ts",
  "ask-peuin": "aiask/ask-handler.ts",
  personality: "aiask/personality-handler.ts",
  "food-catalog": "gov-data/food-catalog/handler.ts",
  friends: "gov-data/friends/handler.ts",
  "goong-place-search": "map/goong-handler.ts",
  "vietmap-place-search": "map/vietmap-handler.ts",
  "home-feed": "feed/handler.ts",
  "home-feed-warm": "feed/warm-handler.ts",
  journal: "journal/handler.ts",
  "notification-push": "worker/notification-push-handler.ts",
  notifications: "notifications/legacy-handler.ts",
  profile: "profile/handler.ts",
  stories: "stories/handler.ts"
};

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "HOME_FEED_WARM_SECRET",
  "HOME_FEED_WARM_VIEWER_LIMIT",
  "APP_SEARCH_WARM_SECRET",
  "APP_SEARCH_WARM_LIMIT",
  "APP_SEARCH_WARM_POSTS_LIMIT",
  "APP_SEARCH_WARM_QUERIES",
  "NOTIFICATION_PUSH_SECRET",
  "FCM_SERVICE_ACCOUNT_JSON",
  "FCM_PROJECT_ID",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_MODEL",
  "GOONG_PLACE_API_KEY",
  "GOONG_API_KEY",
  "VIETMAP_API_KEY",
  "VIETMAP_PLACE_API_KEY",
  "BUNNY_STORAGE_ZONE",
  "BUNNY_STORAGE_API_KEY",
  "BUNNY_API_KEY",
  "BUNNY_STORY_CDN_BASE_URL",
  "BUNNY_STORAGE_HOST",
  "BUNNY_STORY_STORAGE_PREFIX",
  "RESEND_API_KEY",
  "RESEND_FEEDBACK_TO_EMAIL",
  "RESEND_FROM_EMAIL",
  "RESEND_REPLY_TO",
  "PERSONALITY_MARKDOWN_URL",
  "PERSONALITY_MARKDOWN_SOURCE",
  "PERSONALITY_MARKDOWN_BEARER_TOKEN",
  "SEARCH_VECTOR_BUCKET",
  "SEARCH_VECTOR_DIMENSION",
  "SEARCH_VECTOR_DISTANCE_METRIC",
  "SEARCH_VECTOR_INDEXES",
  "OTP_HASH_SECRET"
];

function importPrefix(moduleRelPath) {
  const depth = moduleRelPath.split("/").length;
  return "../".repeat(depth);
}

function extractDenoServeBlock(source) {
  const marker = "Deno.serve(async (request) => {";
  const start = source.indexOf(marker);
  if (start < 0) return null;

  let depth = 0;
  const bodyStart = start + marker.length;
  for (let i = bodyStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      if (depth === 0) {
        const tail = source.slice(i);
        if (!tail.startsWith("});")) return null;
        return {
          before: source.slice(0, start),
          body: source.slice(bodyStart, i),
          after: source.slice(i + 3)
        };
      }
      depth -= 1;
    }
  }
  return null;
}

function convertSource(name, raw, moduleRelPath) {
  let source = raw;

  source = source.replace(/import \{ createClient[^}]+\} from "npm:[^"]+";\n?/g, "");

  for (const key of ENV_KEYS) {
    source = source.replaceAll(`Deno.env.get("${key}")`, `env.${key}`);
  }

  source = source.replaceAll(
    'request.headers.get("Authorization")',
    'readHeader(request.headers, "authorization")'
  );
  source = source.replaceAll(
    'request.headers.get("user-agent")',
    'readHeader(request.headers, "user-agent")'
  );
  source = source.replaceAll(
    'request.headers.get("x-cron-secret")',
    'readHeader(request.headers, "x-cron-secret")'
  );
  source = source.replaceAll(
    'request.headers.get("x-push-secret")',
    'readHeader(request.headers, "x-push-secret")'
  );

  source = source.replaceAll("EdgeRuntime.waitUntil", "runBackgroundTask");
  source = source.replaceAll("result.trim().isNotEmpty", "result.trim().length > 0");
  source = source.replaceAll("crypto.randomUUID()", "randomUUID()");
  source = source.replaceAll(": Request", ": PortedRequest");
  source = source.replaceAll(".isEmpty", ".length === 0");
  source = source.replaceAll(
    "`${supabaseUrl}/functions/v1/personality`",
    '"PERSONALITY_INTERNAL_ENDPOINT"'
  );
  source = source.replaceAll(
    "${supabaseUrl}/functions/v1/personality",
    "PERSONALITY_INTERNAL_ENDPOINT"
  );

  const serve = extractDenoServeBlock(source);
  if (!serve) {
    throw new Error(`${name}: could not find Deno.serve handler`);
  }

  const helperBlock = (serve.before + serve.after).replace(/^type Json = Record<string, unknown>;\n+/m, "");
  const prefix = importPrefix(moduleRelPath);
  const personalityImport = name === "ask-peuin"
    ? `import { handlePersonality } from "./personality-handler.js";\n`
    : "";

  const header = `import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "${prefix}config/env.js";
${personalityImport}import { readHeader, type PortedRequest } from "${prefix}shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[${name}] background task failed", error));
}

`;

  const exportFn = `
export async function handle${toHandlerName(name)}(request: PortedRequest): Promise<Response> {
${serve.body}
}
`;

  let output = `// @ts-nocheck\n${header}${helperBlock}${exportFn}`;

  if (name === "ask-peuin") {
    output = patchAskPeuinPersonalityCall(output);
  }

  return output;
}

function patchAskPeuinPersonalityCall(source) {
  const start = source.indexOf("async function askPersonality(");
  if (start < 0) return source;

  const replacement = `async function askPersonality(options: {
  request: PortedRequest;
  preferredName: string;
  history: { role: ChatRole; content: string }[];
  query: string;
  profileContext: Json;
  foodMemoryContext: Json;
  publicFeedCandidates: PublicFeedFoodCandidate[];
  shouldRecommendFood: boolean;
  mealFilters: MealFilters | null;
}) {
  const body = {
    action: "generate_reply",
    preferred_name: options.preferredName,
    history: options.history,
    query: options.query,
    profile_context: options.profileContext,
    memory_context: options.foodMemoryContext,
    public_feed_candidates: options.publicFeedCandidates,
    should_recommend_food: options.shouldRecommendFood,
    meal_filters: options.mealFilters,
    meal_filters_prompt: mealFiltersPromptBlock(options.mealFilters),
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= PERSONALITY_CALL_ATTEMPTS; attempt++) {
    try {
      const response = await handlePersonality({
        method: "POST",
        url: "http://mcrservice.local/functions/v1/personality",
        headers: {
          authorization: readHeader(options.request.headers, "authorization"),
          apikey: readHeader(options.request.headers, "apikey") || stringValue(env.SUPABASE_ANON_KEY),
          "content-type": "application/json"
        },
        json: async () => body
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        const content = stringValue(data.ai_content);
        if (!content) throw new Error("personality không trả về nội dung trả lời.");
        return content;
      }

      const details = stringValue(data.error) || \`HTTP \${response.status}\`;
      if (
        attempt < PERSONALITY_CALL_ATTEMPTS &&
        PERSONALITY_RETRYABLE_STATUSES.has(response.status)
      ) {
        console.warn(
          \`personality retryable \${response.status} (attempt \${attempt}/\${PERSONALITY_CALL_ATTEMPTS}): \${details}\`,
        );
        await delayMs(450);
        continue;
      }
      throw new PersonalityUpstreamError(response.status, details);
    } catch (error) {
      lastError = error;
      if (error instanceof PersonalityUpstreamError) {
        if (
          attempt < PERSONALITY_CALL_ATTEMPTS &&
          PERSONALITY_RETRYABLE_STATUSES.has(error.status)
        ) {
          await delayMs(450);
          continue;
        }
        throw error;
      }
      if (attempt < PERSONALITY_CALL_ATTEMPTS) {
        console.warn(
          \`personality call failed (attempt \${attempt}/\${PERSONALITY_CALL_ATTEMPTS}): \${errorMessage(error)}\`,
        );
        await delayMs(450);
        continue;
      }
      throw new PersonalityUpstreamError(503, errorMessage(error));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new PersonalityUpstreamError(503, errorMessage(lastError));
}`;

  const endMarker = "function delayMs(ms: number)";
  const end = source.indexOf(endMarker, start);
  if (end < 0) return source;
  return `${source.slice(0, start)}${replacement}\n\n${source.slice(end)}`;
}

function toHandlerName(name) {
  return name
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function main() {
  const names = fs.readdirSync(functionsDir).filter((entry) =>
    fs.existsSync(path.join(functionsDir, entry, "index.ts"))
  );

  let count = 0;
  for (const name of names.sort()) {
    if (name.startsWith("auth-")) {
      console.log(`skipped ${name} (auth handled natively in modules/auth)`);
      continue;
    }

    const target = HANDLER_TARGETS[name];
    if (!target) {
      console.warn(`skipped ${name} (no HANDLER_TARGETS mapping)`);
      continue;
    }

    const raw = fs.readFileSync(path.join(functionsDir, name, "index.ts"), "utf8");
    const converted = convertSource(name, raw, target);
    const outFile = path.join(modulesDir, target);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, converted);
    console.log(`ported ${name} -> modules/${target}`);
    count += 1;
  }

  console.log(`Done: ${count} handlers under ${modulesDir}`);
}

main();
