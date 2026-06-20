// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[app-feedback] background task failed", error));
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resendEndpoint = "https://api.resend.com/emails";
const feedbackBucket = "feedback-attachments";



function createRequestClient(request: PortedRequest) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Thiếu cấu hình SUPABASE_URL hoặc SUPABASE_ANON_KEY.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: readHeader(request.headers, "authorization") ?? "",
      },
    },
  });
}

async function submitFeedback(
  supabase: ReturnType<typeof createRequestClient>,
  request: PortedRequest,
) {
  const { user } = await requireUser(supabase);
  const body = await request.json().catch(() => ({}));
  const feedbackBody = stringValue(body.body);
  const attachmentPaths = readAttachmentPaths(body.attachmentPaths, user.id);

  if (!feedbackBody) {
    throw new Error("Bạn nhập góp ý trước nha.");
  }
  if (feedbackBody.length > 4000) {
    throw new Error("Góp ý hơi dài rồi, bạn rút gọn dưới 4000 ký tự nha.");
  }

  const { data, error } = await supabase
    .from("app_feedback")
    .insert({ user_id: user.id, body: feedbackBody })
    .select("id")
    .single();
  if (error) throw error;

  const feedbackId = stringValue((data as Json | null)?.id);
  if (feedbackId && attachmentPaths.length > 0) {
    const rows = attachmentPaths.map((path) => ({
      feedback_id: feedbackId,
      user_id: user.id,
      bucket: feedbackBucket,
      path,
    }));
    const { error: attachmentError } = await supabase
      .from("app_feedback_attachments")
      .insert(rows);
    if (attachmentError) throw attachmentError;
  }

  const emailResult = await trySendFeedbackEmail({
    feedbackId,
    userId: user.id,
    userEmail: stringValue(user.email),
    feedbackBody,
    attachmentPaths,
    userAgent: readHeader(request.headers, "user-agent"),
  });

  return { feedbackId, ...emailResult };
}

async function requireUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Bạn cần đăng nhập để gửi góp ý.");
  }
  return { user: data.user };
}

function readAttachmentPaths(value: unknown, userId: string) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => stringValue(item))
    .filter((path) => path.startsWith(`${userId}/`))
    .slice(0, 3);
}

async function trySendFeedbackEmail(params: {
  feedbackId: string;
  userId: string;
  userEmail: string;
  feedbackBody: string;
  attachmentPaths: string[];
  userAgent: string | null;
}) {
  try {
    const messageId = await sendFeedbackEmail(params);
    return { emailSent: true, emailMessageId: messageId };
  } catch (error) {
    const emailError = errorMessage(error);
    console.error("app-feedback email error", {
      feedbackId: params.feedbackId,
      userId: params.userId,
      error: emailError,
    });
    return { emailSent: false, emailError };
  }
}

async function sendFeedbackEmail(params: {
  feedbackId: string;
  userId: string;
  userEmail: string;
  feedbackBody: string;
  attachmentPaths: string[];
  userAgent: string | null;
}) {
  const resendApiKey = env.RESEND_API_KEY;
  const to = env.RESEND_FEEDBACK_TO_EMAIL ||
    env.RESEND_REPLY_TO;
  const from = env.RESEND_FROM_EMAIL ||
    "Peuin <onboarding@resend.dev>";
  const replyTo = params.userEmail || env.RESEND_REPLY_TO;

  if (!resendApiKey) {
    throw new Error("Thiếu cấu hình RESEND_API_KEY.");
  }
  if (!to) {
    throw new Error("Thiếu cấu hình RESEND_FEEDBACK_TO_EMAIL.");
  }

  const attachmentText = params.attachmentPaths.length === 0
    ? "Không có ảnh đính kèm."
    : params.attachmentPaths
      .map((path, index) => `${index + 1}. ${feedbackBucket}/${path}`)
      .join("\n");

  const html = renderFeedbackHtml(params, attachmentText);
  const text = [
    "Peuin - Góp ý & Phản hồi mới",
    "",
    `Feedback ID: ${params.feedbackId}`,
    `User ID: ${params.userId}`,
    `User email: ${params.userEmail || "(không có email)"}`,
    `User agent: ${params.userAgent || "(không có)"}`,
    "",
    "Nội dung:",
    params.feedbackBody,
    "",
    "Ảnh đính kèm:",
    attachmentText,
  ].join("\n");

  const response = await fetch(resendEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Peuin có góp ý mới",
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      tags: [{ name: "feature", value: "app_feedback" }],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(resendErrorMessage(data, response.status));
  }

  return stringValue((data as Json).id);
}

function renderFeedbackHtml(
  params: {
    feedbackId: string;
    userId: string;
    userEmail: string;
    feedbackBody: string;
    userAgent: string | null;
  },
  attachmentText: string,
) {
  return `
    <div style="margin:0;padding:28px;background:#fff0ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2b292d;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;box-shadow:0 18px 48px rgba(43,41,45,0.10);">
        <p style="margin:0 0 10px;color:#ff4a1f;font-size:14px;font-weight:800;">Peuin</p>
        <h1 style="margin:0 0 18px;font-size:26px;line-height:1.25;">Góp ý & Phản hồi mới</h1>
        <table style="width:100%;margin:0 0 22px;border-collapse:collapse;color:#737083;font-size:14px;line-height:1.6;">
          ${metaRow("Feedback ID", params.feedbackId)}
          ${metaRow("User ID", params.userId)}
          ${metaRow("User email", params.userEmail || "(không có email)")}
          ${metaRow("User agent", params.userAgent || "(không có)")}
        </table>
        <p style="margin:0 0 8px;color:#737083;font-size:14px;font-weight:700;">Nội dung</p>
        <div style="white-space:pre-wrap;margin:0 0 22px;padding:16px;border-radius:16px;background:#fff6f6;font-size:16px;line-height:1.6;">${escapeHtml(params.feedbackBody)}</div>
        <p style="margin:0 0 8px;color:#737083;font-size:14px;font-weight:700;">Ảnh đính kèm</p>
        <pre style="white-space:pre-wrap;margin:0;padding:16px;border-radius:16px;background:#f7f7f8;color:#4d4854;font-size:13px;line-height:1.6;">${escapeHtml(attachmentText)}</pre>
      </div>
    </div>
  `;
}

function metaRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding:4px 14px 4px 0;font-weight:700;color:#4d4854;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:4px 0;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>
  `;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resendErrorMessage(data: unknown, status: number) {
  if (data && typeof data === "object") {
    const row = data as Json;
    const message = stringValue(row.message ?? row.error);
    if (message) {
      return `Không gửi được email Resend: ${message}`;
    }
  }
  return `Không gửi được email Resend. HTTP ${status}.`;
}

function stringValue(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : value == null
    ? ""
    : String(value);
}

function jsonResponse(body: Json, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return stringValue((error as { message?: unknown }).message);
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "Có lỗi xảy ra khi gửi góp ý.";
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error as Json;
}

export async function handleAppFeedback(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Không tìm thấy endpoint góp ý." }, 404);
    }

    const supabase = createRequestClient(request);
    return jsonResponse(await submitFeedback(supabase, request), 200);
  } catch (error) {
    console.error("app-feedback error", error);
    return jsonResponse(
      { error: errorMessage(error), details: errorDetails(error) },
      400,
    );
  }

}
