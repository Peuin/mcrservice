import { z } from "zod";

export const inboxQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().datetime({ offset: true }).optional()
}).strict();

export const notificationParamsSchema = z.object({ notificationId: z.string().uuid() }).strict();

export const pushTokenSchema = z.object({
  token: z.string().trim().min(1).max(4096),
  platform: z.enum(["android", "ios", "macos", "web"]).default("android"),
  deviceId: z.string().trim().max(255).optional(),
  appVersion: z.string().trim().max(100).optional()
}).strict();

export const unregisterPushTokenSchema = z.object({
  token: z.string().trim().min(1).max(4096)
}).strict();

export const pushNotificationSchema = z.object({ notificationId: z.string().uuid() }).strict();

export type InboxQuery = z.infer<typeof inboxQuerySchema>;
export type PushTokenInput = z.infer<typeof pushTokenSchema>;
export type UnregisterPushTokenInput = z.infer<typeof unregisterPushTokenSchema>;
