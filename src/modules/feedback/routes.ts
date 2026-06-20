import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { callEdgeFunction, type EdgeFunctionResult } from "../../shared/edge-function-proxy.js";

const feedbackSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  attachmentPaths: z.array(z.string().trim().min(1)).max(3).optional()
}).strict();

function send(reply: FastifyReply, result: EdgeFunctionResult) {
  return reply.code(result.status).send(result.payload);
}

export const feedbackRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/v1/feedback", { schema: { hide: true } }, async (request, reply) => {
    const parsed = feedbackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu góp ý không hợp lệ.", details: parsed.error.flatten() });
    }
    return send(reply, await callEdgeFunction(request, {
      functionName: "app-feedback",
      method: "POST",
      body: parsed.data
    }));
  });

  app.post("/app-feedback", { schema: { hide: true } }, async (request, reply) =>
    send(reply, await callEdgeFunction(request, { functionName: "app-feedback", method: "POST", body: request.body }))
  );
};
