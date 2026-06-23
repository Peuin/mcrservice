import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Biến do Docker/K3s inject có độ ưu tiên cao hơn nội dung trong file.
loadDotenv({ path: ".env", override: false });

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function optionalSecret(min = 1) {
  return z.preprocess(emptyToUndefined, z.string().min(min).optional());
}

function optionalUrl() {
  return z.preprocess(emptyToUndefined, z.string().url().optional());
}

function optionalEmail() {
  return z.preprocess(emptyToUndefined, z.string().email().optional());
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGIN: z.string().default("*"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret(),
  SUPABASE_SECRET_KEY: optionalSecret(),
  HOME_FEED_WARM_SECRET: optionalSecret(16),
  APP_SEARCH_WARM_SECRET: optionalSecret(16),
  NOTIFICATION_PUSH_SECRET: optionalSecret(16),
  HOME_FEED_WARM_VIEWER_LIMIT: z.coerce.number().int().positive().default(50),
  APP_SEARCH_WARM_LIMIT: z.coerce.number().int().positive().default(8),
  APP_SEARCH_WARM_POSTS_LIMIT: z.coerce.number().int().positive().default(20),
  APP_SEARCH_WARM_QUERIES: z.preprocess(emptyToUndefined, z.string().optional()),
  OTP_HASH_SECRET: optionalSecret(16),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(8),
  RESEND_API_KEY: optionalSecret(),
  RESEND_FROM_EMAIL: z.string().default("Peuin <onboarding@resend.dev>"),
  RESEND_REPLY_TO: optionalEmail(),
  RESEND_FEEDBACK_TO_EMAIL: optionalEmail(),
  UPSTASH_REDIS_REST_URL: optionalUrl(),
  UPSTASH_REDIS_REST_TOKEN: optionalSecret(),
  GEMINI_API_KEY: optionalSecret(),
  GOOGLE_API_KEY: optionalSecret(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GOONG_PLACE_API_KEY: optionalSecret(),
  GOONG_API_KEY: optionalSecret(),
  VIETMAP_API_KEY: optionalSecret(),
  VIETMAP_PLACE_API_KEY: optionalSecret(),
  BUNNY_STORAGE_ZONE: optionalSecret(),
  BUNNY_STORAGE_API_KEY: optionalSecret(),
  BUNNY_API_KEY: optionalSecret(),
  BUNNY_STORY_CDN_BASE_URL: optionalUrl(),
  BUNNY_STORAGE_HOST: z.string().default("storage.bunnycdn.com"),
  BUNNY_STORY_STORAGE_PREFIX: z.string().default("stories"),
  FCM_SERVICE_ACCOUNT_JSON: optionalSecret(),
  FCM_PROJECT_ID: optionalSecret(),
  PERSONALITY_MARKDOWN_URL: optionalUrl(),
  PERSONALITY_MARKDOWN_SOURCE: z.preprocess(
    emptyToUndefined,
    z.enum(["local", "remote"]).default("local"),
  ),
  PERSONALITY_MARKDOWN_BEARER_TOKEN: optionalSecret(),
  SEARCH_VECTOR_BUCKET: z.string().default("search"),
  SEARCH_VECTOR_DIMENSION: z.coerce.number().int().positive().default(768),
  SEARCH_VECTOR_DISTANCE_METRIC: z.string().default("cosine"),
  SEARCH_VECTOR_INDEXES: z.preprocess(emptyToUndefined, z.string().optional()),
});

export const env = envSchema.parse(process.env);
