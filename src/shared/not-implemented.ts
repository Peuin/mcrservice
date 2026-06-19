import type { FastifyReply } from "fastify";

export function notImplemented(feature: string, reply: FastifyReply) {
  return reply.code(501).send({
    error: "not_implemented",
    message: `${feature} chưa được port từ Supabase Edge Function sang TypeScript backend.`
  });
}
