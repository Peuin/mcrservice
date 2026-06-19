import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { completeResetSchema, identifierSchema, loginSchema, signupSchema, verifyOtpSchema } from "./schemas.js";
import { completePasswordReset, login, requestPasswordReset, signup, SignupError, verifyPasswordResetOtp } from "./service.js";
import { completeResetDocs, loginDocs, requestResetDocs, signupDocs, verifyOtpDocs } from "./swagger.js";

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof SignupError) {
    return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return reply.code(400).send({ error: message });
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/v1/user", { schema: loginDocs }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await login(parsed.data.email, parsed.data.password, {
        requestId: request.id,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        onAuditError: (error) => request.log.error({ err: error }, "Failed to write auth.login audit event")
      });
    } catch (error) { return fail(reply, error); }
  });

  const signupHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await signup(parsed.data.email, parsed.data.password);
    } catch (error) { return fail(reply, error); }
  };
  app.post("/auth/signup", { schema: signupDocs }, signupHandler);
  app.post("/auth/v1/signup", { schema: { ...signupDocs, hide: true } }, signupHandler);

  app.post("/auth/password-reset", { schema: requestResetDocs }, async (request, reply) => {
    const parsed = identifierSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await requestPasswordReset(parsed.data.emailOrUsername, parsed.data.locale ?? "vi", request.ip, request.headers["user-agent"]);
      return { ok: true };
    } catch (error) { return fail(reply, error); }
  });

  app.post("/auth/password-reset/verify", { schema: verifyOtpDocs }, async (request, reply) => {
    const parsed = verifyOtpSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      await verifyPasswordResetOtp(parsed.data.emailOrUsername, parsed.data.otpCode, parsed.data.locale ?? "vi");
      return { ok: true };
    } catch (error) { return fail(reply, error); }
  });

  app.post("/auth/password-reset/complete", { schema: completeResetDocs }, async (request, reply) => {
    const parsed = completeResetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const email = await completePasswordReset(parsed.data.emailOrUsername, parsed.data.otpCode, parsed.data.newPassword, parsed.data.locale ?? "vi");
      return { ok: true, email };
    } catch (error) { return fail(reply, error); }
  });
};
