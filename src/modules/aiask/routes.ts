import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { proxyEdgeFunction, type EdgeFunctionResult } from "../../shared/edge-function-proxy.js";
import { askPeuinSchema, personalityReplySchema, recommendationFeedbackSchema } from "./schemas.js";
import { askPeuin, generatePersonalityReply, getTodaySession, saveRecommendationFeedback, testPersonalityMarkdown } from "./service.js";
import { askPeuinDocs, personalityHealthDocs, personalityReplyDocs, recommendationFeedbackDocs, todaySessionDocs } from "./swagger.js";

function invalid(reply: FastifyReply, details: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu Ask Peuin không hợp lệ.", details });
}
function send(reply: FastifyReply, result: EdgeFunctionResult) { return reply.code(result.status).send(result.payload); }

export const aiAskRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/v1/ai/ask", { schema: askPeuinDocs }, async (request, reply) => {
    const parsed = askPeuinSchema.safeParse(request.body);
    return parsed.success ? send(reply, await askPeuin(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.get("/api/v1/ai/sessions/today", { schema: todaySessionDocs }, async (request, reply) =>
    send(reply, await getTodaySession(request)));
  app.post("/api/v1/ai/recommendations/feedback", { schema: recommendationFeedbackDocs }, async (request, reply) => {
    const parsed = recommendationFeedbackSchema.safeParse(request.body);
    return parsed.success ? send(reply, await saveRecommendationFeedback(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.post("/api/v1/ai/personality/reply", { schema: personalityReplyDocs }, async (request, reply) => {
    const parsed = personalityReplySchema.safeParse(request.body);
    return parsed.success ? send(reply, await generatePersonalityReply(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.get("/api/v1/ai/personality/health", { schema: personalityHealthDocs }, async (request, reply) =>
    send(reply, await testPersonalityMarkdown(request)));

  for (const path of ["/ask-peuin", "/user/ask-peuin"]) {
    app.post(path, { schema: { hide: true } }, (request, reply) =>
      proxyEdgeFunction(request, reply, { functionName: "ask-peuin", method: "POST", body: request.body }));
  }
  for (const path of ["/personality", "/user/personality"]) {
    app.post(path, { schema: { hide: true } }, (request, reply) =>
      proxyEdgeFunction(request, reply, { functionName: "personality", method: "POST", body: request.body }));
  }
};
