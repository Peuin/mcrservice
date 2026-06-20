import { z } from "zod";

const refreshSchema = z.union([z.string(), z.number(), z.boolean()]).optional();

export const discoverQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  refresh: refreshSchema
}).strict();

export const searchPostsQuerySchema = z.object({
  placeId: z.string().uuid().optional(),
  food: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  refresh: refreshSchema
}).strict().refine((value) => Boolean(value.placeId) !== Boolean(value.food), {
  message: "Chỉ truyền một trong hai field placeId hoặc food."
});

export const recentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  refresh: refreshSchema
}).strict();

export const recentParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const saveRecentSchema = z.object({
  searchType: z.enum(["user", "place", "food"]),
  query: z.string().trim().min(1).max(200),
  targetId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  subtitle: z.string().trim().max(500).default(""),
  imageUrl: z.string().trim().max(2048).optional()
}).strict();

export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;
export type SearchPostsQuery = z.infer<typeof searchPostsQuerySchema>;
export type RecentQuery = z.infer<typeof recentQuerySchema>;
export type SaveRecentInput = z.infer<typeof saveRecentSchema>;
