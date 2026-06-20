import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursorCreatedAt: z.string().datetime({ offset: true }).optional(),
  feedSeed: z.string().trim().min(1).max(128).optional(),
  refresh: z.union([z.string(), z.number(), z.boolean()]).optional()
}).strict();

export const postParamsSchema = z.object({ postId: uuidSchema }).strict();
export const commentParamsSchema = z.object({ commentId: uuidSchema }).strict();
export const replyParamsSchema = postParamsSchema.extend({ commentId: uuidSchema });

export const createPostSchema = z.object({
  caption: z.string().trim().min(1).max(5000),
  visibility: z.enum(["public", "followers", "private"]).default("public"),
  mediaPath: z.string().trim().min(1).max(2048),
  placeId: uuidSchema.optional(),
  placeName: z.string().trim().max(500).default(""),
  priceLabel: z.string().trim().max(100).optional(),
  foodLabel: z.string().trim().max(200).default(""),
  frameId: uuidSchema.optional(),
  frameLabel: z.string().trim().max(200).default(""),
  plainLayout: z.boolean().default(false),
  promptMode: z.string().trim().max(100).default(""),
  prompt: z.string().trim().max(1000).default(""),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  mentions: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  topics: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
}).strict();

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000)
}).strict();

export const toggleLoveSchema = z.object({
  currentlyLiked: z.boolean()
}).strict();

export type FeedQuery = z.infer<typeof feedQuerySchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type ToggleLoveInput = z.infer<typeof toggleLoveSchema>;
