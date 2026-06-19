import { z } from "zod";

export const localeSchema = z.enum(["vi", "en"]).default("vi");

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
}).strict();

export const identifierSchema = z.object({
  emailOrUsername: z.string().trim().min(1),
  locale: localeSchema.optional()
});

export const verifyOtpSchema = identifierSchema.extend({
  otpCode: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().length(6))
});

export const completeResetSchema = verifyOtpSchema.extend({
  newPassword: z.string().min(8)
});

export type Locale = z.infer<typeof localeSchema>;
