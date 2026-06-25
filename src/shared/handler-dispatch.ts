import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { handleAskPeuin } from "../modules/aiask/ask-handler.js";
import { handlePersonality } from "../modules/aiask/personality-handler.js";
import { handleAppFeedback } from "../modules/feedback/handler.js";
import { handleHomeFeed } from "../modules/feed/handler.js";
import { handleHomeFeedWarm } from "../modules/feed/warm-handler.js";
import { handleFoodCatalog } from "../modules/gov-data/food-catalog/handler.js";
import { handleFriends } from "../modules/gov-data/friends/handler.js";
import { handleJournal } from "../modules/journal/handler.js";
import { handleGoongPlaceSearch } from "../modules/map/goong-handler.js";
import { handleAppSearch } from "../modules/search/handler.js";
import { handleAppSearchWarm } from "../modules/search/warm-handler.js";
import { handleStories } from "../modules/stories/handler.js";
import { handleNotificationPush } from "../modules/worker/notification-push-handler.js";
import { localizeApiPayload } from "./api-i18n.js";
import type { ApiResult } from "./api-result.js";
import { invokePorted, type PortedRequest } from "./handler-runtime.js";

export type HandlerResult = ApiResult;

type HandlerDispatchOptions = {
  name: string;
  path?: string;
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, unknown>;
  body?: unknown;
  internalSecret?: string;
  internalSecretHeader?: "x-cron-secret" | "x-push-secret";
  forwardClientAuth?: boolean;
};

const handlers: Record<string, (request: PortedRequest) => Promise<Response>> = {
  "app-feedback": handleAppFeedback,
  "app-search": handleAppSearch,
  "app-search-warm": handleAppSearchWarm,
  "ask-peuin": handleAskPeuin,
  "food-catalog": handleFoodCatalog,
  friends: handleFriends,
  "goong-place-search": handleGoongPlaceSearch,
  "home-feed": handleHomeFeed,
  "home-feed-warm": handleHomeFeedWarm,
  journal: handleJournal,
  "notification-push": handleNotificationPush,
  personality: handlePersonality,
  stories: handleStories,
  "vietmap-place-search": handleGoongPlaceSearch
};

export async function callHandler(
  request: Pick<FastifyRequest, "method" | "headers" | "id">,
  options: HandlerDispatchOptions
): Promise<HandlerResult> {
  const handler = handlers[options.name];
  if (!handler) {
    return {
      status: 501,
      payload: { success: false, code: "NOT_IMPLEMENTED", message: `Handler ${options.name} is not available.` }
    };
  }

  const headers = normalizeHeaders(request.headers, options);
  const url = buildHandlerUrl(options);
  const result = await invokePorted(handler, {
    method: options.method ?? (request.method as "GET" | "POST" | "DELETE"),
    headers,
    url,
    body: options.body
  });

  return {
    status: result.status,
    payload: localizeApiPayload(request, result.status, result.payload, { functionName: options.name })
  };
}

export async function proxyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
  options: HandlerDispatchOptions
) {
  const result = await callHandler(request, options);
  return reply.code(result.status).send(result.payload);
}

function buildHandlerUrl(options: HandlerDispatchOptions) {
  const suffix = options.path ? `/${options.path.replace(/^\/+/, "")}` : "";
  const url = new URL(`/${options.name}${suffix}`, "http://mcrservice.local");
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function normalizeHeaders(
  headers: FastifyRequest["headers"],
  options: HandlerDispatchOptions
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) normalized[key.toLowerCase()] = value[0];
    else if (typeof value === "string") normalized[key.toLowerCase()] = value;
  }
  if (options.forwardClientAuth === false) {
    delete normalized.authorization;
    delete normalized.apikey;
  } else if (!normalized.apikey) {
    normalized.apikey = env.SUPABASE_ANON_KEY;
  }
  if (options.internalSecret) {
    normalized[options.internalSecretHeader ?? "x-cron-secret"] = options.internalSecret;
  }
  return normalized;
}
