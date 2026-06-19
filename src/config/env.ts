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
  OTP_HASH_SECRET: z.string().min(16).optional(),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(8),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().default("Peuin <onboarding@resend.dev>"),
  RESEND_REPLY_TO: z.string().email().optional()
});

export const env = schema.parse(process.env);
