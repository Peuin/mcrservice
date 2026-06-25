import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { callHandler, type HandlerResult } from "../../shared/handler-dispatch.js";

const feedbackSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  attachmentPaths: z.array(z.string().trim().min(1)).max(3).optional()
}).strict();

function send(reply: FastifyReply, result: HandlerResult) {
  return reply.code(result.status).send(result.payload);
}

export const feedbackRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/v1/feedback", { schema: { hide: true } }, async (request, reply) => {
    const parsed = feedbackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu góp ý không hợp lệ.", details: parsed.error.flatten() });
    }
    return send(reply, await callHandler(request, {
      name: "app-feedback",
      method: "POST",
      body: parsed.data
    }));
  });
};
