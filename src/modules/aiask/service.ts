import type { FastifyRequest } from "fastify";
import { callHandler } from "../../shared/handler-dispatch.js";
import type { AskPeuinInput, PersonalityReplyInput, RecommendationFeedbackInput } from "./schemas.js";

type AiAskContext = Pick<FastifyRequest, "method" | "headers" | "id">;

function callAskPeuin(context: AiAskContext, body: Record<string, unknown>) {
  return callHandler(context, { name: "ask-peuin", method: "POST", body });
}

export function askPeuin(context: AiAskContext, input: AskPeuinInput) {
  return callAskPeuin(context, input);
}

export function getTodaySession(context: AiAskContext) {
  return callAskPeuin(context, { action: "get_today_session" });
}

export function saveRecommendationFeedback(context: AiAskContext, input: RecommendationFeedbackInput) {
  return callAskPeuin(context, { action: "recommendation_feedback", ...input });
}

export function generatePersonalityReply(context: AiAskContext, input: PersonalityReplyInput) {
  return callHandler(context, { name: "personality", method: "POST", body: { action: "generate_reply", ...input } });
}

export function testPersonalityMarkdown(context: AiAskContext) {
  return callHandler(context, { name: "personality", method: "POST", body: { action: "test_personality_markdown" } });
}
