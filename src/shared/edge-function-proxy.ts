import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { localizeApiPayload } from "./api-i18n.js";

type ProxyOptions = {
  functionName: string;
  functionPath?: string;
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, unknown>;
  body?: unknown;
  internalSecret?: string;
  internalSecretHeader?: "x-cron-secret" | "x-push-secret";
};

export type EdgeFunctionResult = {
  status: number;
  payload: unknown;
};

export async function callEdgeFunction(
  request: Pick<FastifyRequest, "method" | "headers" | "id">,
  options: ProxyOptions
): Promise<EdgeFunctionResult> {
  const path = options.functionPath ? `/${options.functionPath.replace(/^\/+/, "")}` : "";
  const url = new URL(`/functions/v1/${options.functionName}${path}`, env.SUPABASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const authorization = request.headers.authorization;
  const response = await fetch(url, {
    method: options.method ?? request.method as "GET" | "POST" | "DELETE",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      ...(authorization ? { authorization } : {}),
      ...(options.internalSecret ? { [options.internalSecretHeader ?? "x-cron-secret"]: options.internalSecret } : {}),
      "content-type": "application/json;charset=UTF-8",
      "x-client": String(request.headers["x-client"] ?? "peuin-mcrservice"),
      "x-request-id": request.id
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  const payload = text ? safeJson(text) : null;
  return {
    status: response.status,
    payload: localizeApiPayload(request, response.status, payload, options)
  };
}

export async function proxyEdgeFunction(
  request: FastifyRequest,
  reply: FastifyReply,
  options: ProxyOptions
) {
  const result = await callEdgeFunction(request, options);
  return reply.code(result.status).send(result.payload);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, code: "UPSTREAM_INVALID_RESPONSE", message: "Feed service returned invalid JSON." };
  }
}
