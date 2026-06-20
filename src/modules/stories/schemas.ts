import { z } from "zod";

export const storiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(80).default(40)
}).strict();

export const storyTextOverlaySchema = z.object({
  text: z.string().trim().min(1).max(500),
  style: z.enum(["modern", "classic", "signature", "editor", "poster"]).default("modern"),
  color: z.number().int(),
  backgroundColor: z.number().int().nullable().optional(),
  isItalic: z.boolean().default(false),
  fontSize: z.number().min(8).max(160).default(28),
  textAlign: z.enum(["left", "right", "center", "justify", "start", "end"]).default("center"),
  hasShadow: z.boolean().default(true),
  offsetX: z.number().min(-5000).max(5000).default(0),
  offsetY: z.number().min(-5000).max(5000).default(0)
}).strict();

export const createStorySchema = z.object({
  mediaBase64: z.string().min(4).max(20_000_000),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic"]).default("image/jpeg"),
  textOverlay: storyTextOverlaySchema.nullable().optional(),
  caption: z.string().trim().max(1000).optional()
}).strict();

export type StoriesQuery = z.infer<typeof storiesQuerySchema>;
export type CreateStoryInput = z.infer<typeof createStorySchema>;
