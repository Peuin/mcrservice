import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { logAuditEvent } from "../../shared/audit.js";
import { supabaseAdmin } from "../../shared/supabase.js";
import type { Locale } from "./schemas.js";

type Json = Record<string, unknown>;

const messages = {
  vi: {
    accountNotFound: "Không tìm thấy tài khoản với thông tin này.",
    otpInvalid: "Mã OTP đã hết hạn hoặc không hợp lệ. Vui lòng gửi lại mã.",
    otpIncorrect: "Mã OTP không đúng. Vui lòng thử lại.",
    tooManyAttempts: "Bạn đã nhập sai quá nhiều lần. Vui lòng gửi lại mã."
  },
  en: {
    accountNotFound: "No account found with that information.",
    otpInvalid: "This code has expired or is invalid. Request a new code.",
    otpIncorrect: "That code is incorrect. Please try again.",
    tooManyAttempts: "Too many wrong attempts. Request a new code."
  }
} as const;

function requireAdmin() {
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return supabaseAdmin;
}

function sessionIdFromAccessToken(accessToken?: string) {
  if (!accessToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      session_id?: unknown;
    };
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

export type AuditRequestContext = {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  onAuditError?: (error: unknown) => void;
};

export async function login(email: string, password: string, context: AuditRequestContext = {}) {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;

  if (data.user) {
    await logAuditEvent({
      eventType: "auth.login",
      action: "insert",
      schemaName: "auth",
      tableName: "sessions",
      recordId: sessionIdFromAccessToken(data.session?.access_token),
      actorId: data.user.id,
      actorType: "user",
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      newData: { email: data.user.email ?? email.toLowerCase() },
      metadata: { provider: data.user.app_metadata.provider ?? "email" }
    }).catch((auditError) => context.onAuditError?.(auditError));
  }

  return data;
}

export class SignupError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode: number) {
    super(message);
    this.name = "SignupError";
  }
}

function normalizeSignupError(error: unknown) {
  const value = error as { code?: string; message?: string; status?: number };
  const code = value.code?.toLowerCase() ?? "";
  const message = value.message?.toLowerCase() ?? "";

  if (code === "user_already_exists" || message.includes("already registered") || message.includes("already exists")) {
    return new SignupError("EMAIL_ALREADY_EXISTS", "Email đã được đăng ký.", 409);
  }
  if (code === "weak_password" || message.includes("password") && (message.includes("weak") || message.includes("characters"))) {
    return new SignupError("WEAK_PASSWORD", "Mật khẩu không đáp ứng chính sách bảo mật.", 422);
  }
  if (code.includes("rate_limit") || value.status === 429) {
    return new SignupError("RATE_LIMITED", "Bạn thao tác quá nhanh. Vui lòng thử lại sau.", 429);
  }
  if (message.includes("database error saving new user")) {
    return new SignupError("PROFILE_CREATE_FAILED", "Không thể tạo hồ sơ người dùng.", 500);
  }
  if (error instanceof TypeError || message.includes("fetch failed") || message.includes("network")) {
    return new SignupError("AUTH_UNAVAILABLE", "Không thể kết nối dịch vụ xác thực.", 503);
  }
  return new SignupError("SIGNUP_FAILED", "Không thể đăng ký tài khoản. Vui lòng thử lại.", 400);
}

export async function signup(email: string, password: string) {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  try {
    const { data, error } = await client.auth.signUp({ email: email.toLowerCase(), password });
    if (error) throw error;
    return {
      user: data.user ? { id: data.user.id, email: data.user.email ?? null } : null,
      session: data.session ? {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in
      } : null,
      requiresEmailConfirmation: data.session === null
    };
  } catch (error) {
    if (error instanceof SignupError) throw error;
    throw normalizeSignupError(error);
  }
}

async function resolveEmail(identifier: string, locale: Locale) {
  if (identifier.includes("@")) return identifier.toLowerCase();
  const { data, error } = await requireAdmin()
    .from("profiles")
    .select("email")
    .eq("username", identifier.replace(/^@+/, "").toLowerCase())
    .maybeSingle();
  if (error) throw error;
  if (!data?.email) throw new Error(messages[locale].accountNotFound);
  return String(data.email).toLowerCase();
}

function hashOtp(email: string, otpCode: string) {
  const secret = env.OTP_HASH_SECRET ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("OTP_HASH_SECRET is not configured.");
  return createHash("sha256").update(`${email}:${otpCode}:${secret}`).digest("hex");
}

function hashesMatch(expected: string, actual: string) {
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(actual, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function latestOtp(email: string) {
  const { data, error } = await requireAdmin().schema("core")
    .from("password_reset_otps")
    .select("id, otp_hash, attempts")
    .eq("email", email)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function consumeOtp(id: string) {
  const { error } = await requireAdmin().schema("core")
    .from("password_reset_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

async function assertOtp(email: string, otpCode: string, locale: Locale, consume: boolean) {
  const row = await latestOtp(email);
  if (!row) throw new Error(messages[locale].otpInvalid);
  const attempts = Number(row.attempts ?? 0);
  if (attempts >= env.OTP_MAX_ATTEMPTS) {
    await consumeOtp(String(row.id));
    throw new Error(messages[locale].tooManyAttempts);
  }
  if (!hashesMatch(String(row.otp_hash), hashOtp(email, otpCode))) {
    const nextAttempts = attempts + 1;
    const { error } = await requireAdmin().schema("core")
      .from("password_reset_otps").update({ attempts: nextAttempts }).eq("id", row.id);
    if (error) throw error;
    if (nextAttempts >= env.OTP_MAX_ATTEMPTS) await consumeOtp(String(row.id));
    throw new Error(nextAttempts >= env.OTP_MAX_ATTEMPTS
      ? messages[locale].tooManyAttempts : messages[locale].otpIncorrect);
  }
  if (consume) await consumeOtp(String(row.id));
}

async function sendEmail(email: string, otpCode: string, locale: Locale) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [email],
      subject: locale === "vi" ? "Mã xác thực đặt lại mật khẩu Peuin" : "Peuin password reset code",
      text: locale === "vi"
        ? `Mã xác thực của bạn: ${otpCode}. Mã hết hạn sau ${env.OTP_TTL_MINUTES} phút.`
        : `Your verification code: ${otpCode}. It expires in ${env.OTP_TTL_MINUTES} minutes.`,
      ...(env.RESEND_REPLY_TO ? { reply_to: env.RESEND_REPLY_TO } : {}),
      tags: [{ name: "feature", value: "password_reset_otp" }, { name: "locale", value: locale }]
    })
  });
  const payload = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new Error(String(payload.message ?? `Resend HTTP ${response.status}`));
  return String(payload.id ?? "");
}

export async function requestPasswordReset(identifier: string, locale: Locale, ip?: string, userAgent?: string) {
  const admin = requireAdmin();
  let email = "";
  try {
    email = await resolveEmail(identifier, locale);
    const otpCode = String(randomInt(100000, 1000000));
    const { error } = await admin.schema("core").from("password_reset_otps").insert({
      email, otp_hash: hashOtp(email, otpCode),
      expires_at: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000).toISOString()
    });
    if (error) throw error;
    const messageId = await sendEmail(email, otpCode, locale);
    await admin.schema("core").from("password_reset_requests").insert({
      identifier, resolved_email: email, delivery_status: "sent", email_provider: "resend",
      provider_message_id: messageId || null, requester_ip: ip || null, user_agent: userAgent || null
    });
  } catch (error) {
    await admin.schema("core").from("password_reset_requests").insert({
      identifier, resolved_email: email || null, delivery_status: "failed",
      error_message: error instanceof Error ? error.message : String(error), email_provider: "resend",
      requester_ip: ip || null, user_agent: userAgent || null
    });
    throw error;
  }
}

export async function verifyPasswordResetOtp(identifier: string, otpCode: string, locale: Locale) {
  const email = await resolveEmail(identifier, locale);
  await assertOtp(email, otpCode, locale, false);
}

export async function completePasswordReset(identifier: string, otpCode: string, password: string, locale: Locale) {
  const admin = requireAdmin();
  const email = await resolveEmail(identifier, locale);
  await assertOtp(email, otpCode, locale, true);
  const { data, error } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error(messages[locale].accountNotFound);
  const { error: updateError } = await admin.auth.admin.updateUserById(String(data.id), { password });
  if (updateError) throw updateError;
  return email;
}
