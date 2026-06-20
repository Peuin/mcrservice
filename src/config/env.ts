import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Biến do Docker/K3s inject có độ ưu tiên cao hơn nội dung trong file.
loadDotenv({ path: ".env", override: false });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGIN: z.string().default("*"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  HOME_FEED_WARM_SECRET: z.string().min(16).optional(),
  APP_SEARCH_WARM_SECRET: z.string().min(16).optional(),
  NOTIFICATION_PUSH_SECRET: z.string().min(16).optional(),
  HOME_FEED_WARM_VIEWER_LIMIT: z.coerce.number().int().positive().default(50),
  APP_SEARCH_WARM_LIMIT: z.coerce.number().int().positive().default(8),
  APP_SEARCH_WARM_POSTS_LIMIT: z.coerce.number().int().positive().default(20),
  APP_SEARCH_WARM_QUERIES: z.string().optional(),
  OTP_HASH_SECRET: z.string().min(16).optional(),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(8),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().default("Peuin <onboarding@resend.dev>"),
  RESEND_REPLY_TO: z.string().email().optional(),
  RESEND_FEEDBACK_TO_EMAIL: z.string().email().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GOOGLE_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GOONG_PLACE_API_KEY: z.string().min(1).optional(),
  GOONG_API_KEY: z.string().min(1).optional(),
  VIETMAP_API_KEY: z.string().min(1).optional(),
  VIETMAP_PLACE_API_KEY: z.string().min(1).optional(),
  BUNNY_STORAGE_ZONE: z.string().min(1).optional(),
  BUNNY_STORAGE_API_KEY: z.string().min(1).optional(),
  BUNNY_API_KEY: z.string().min(1).optional(),
  BUNNY_STORY_CDN_BASE_URL: z.string().url().optional(),
  BUNNY_STORAGE_HOST: z.string().default("storage.bunnycdn.com"),
  BUNNY_STORY_STORAGE_PREFIX: z.string().default("stories"),
  FCM_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  FCM_PROJECT_ID: z.string().min(1).optional(),
  PERSONALITY_MARKDOWN_URL: z.string().url().optional(),
  PERSONALITY_MARKDOWN_SOURCE: z.enum(["local", "remote"]).default("local"),
  PERSONALITY_MARKDOWN_BEARER_TOKEN: z.string().min(1).optional(),
  SEARCH_VECTOR_BUCKET: z.string().default("search"),
  SEARCH_VECTOR_DIMENSION: z.coerce.number().int().positive().default(768),
  SEARCH_VECTOR_DISTANCE_METRIC: z.string().default("cosine"),
  SEARCH_VECTOR_INDEXES: z.string().optional()
});

export const env = schema.parse(process.env);
