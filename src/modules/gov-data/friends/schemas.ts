import { z } from "zod";

export const userIdParamsSchema = z.object({ userId: z.string().uuid() }).strict();
export const requestIdParamsSchema = z.object({ requestId: z.string().uuid() }).strict();
export const friendsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
}).strict();
export const requestsQuerySchema = z.object({ direction: z.enum(["incoming", "outgoing"]).default("incoming") }).strict();
export const respondRequestSchema = z.object({ accept: z.boolean() }).strict();

export type FriendsQuery = z.infer<typeof friendsQuerySchema>;
export type RequestsQuery = z.infer<typeof requestsQuerySchema>;
export type RespondRequestInput = z.infer<typeof respondRequestSchema>;
