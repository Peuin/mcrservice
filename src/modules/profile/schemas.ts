import { z } from "zod";

const refreshSchema = z.union([z.string(), z.number(), z.boolean()]).optional();
export const profileRefreshQuerySchema = z.object({ refresh: refreshSchema }).strict();

export const profileQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  username: z.string().trim().transform((value) => value.replace(/^@+/, "").toLowerCase()).pipe(
    z.string().regex(/^[a-z0-9_]{3,30}$/)
  ).optional(),
  refresh: refreshSchema
}).strict().refine((value) => !(value.userId && value.username), {
  message: "Chỉ truyền userId hoặc username, không truyền đồng thời."
});

export const profileParamsSchema = z.object({ userId: z.string().uuid() }).strict();

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  username: z.string().trim().transform((value) => value.replace(/^@+/, "").toLowerCase()).pipe(
    z.string().regex(/^[a-z0-9_]{3,30}$/)
  ),
  bio: z.string().trim().max(1000).default(""),
  podcastUrl: z.string().trim().max(2048).default(""),
  showInstagramBadge: z.boolean().default(true),
  showRecentViews: z.boolean().default(false),
  isPrivate: z.boolean().default(false)
}).strict();

export type ProfileQuery = z.infer<typeof profileQuerySchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
