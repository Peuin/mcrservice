import { z } from "zod";

export const createFoodCatalogItemSchema = z.object({
  nameVi: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200).optional(),
  iconBucket: z.string().trim().min(1).max(100).default("food-catalog"),
  iconPath: z.string().trim().max(2048).optional(),
  iconUrl: z.string().trim().url().max(2048).optional()
}).strict().refine((value) => Boolean(value.iconPath) || Boolean(value.iconUrl), {
  message: "Food Catalog cần iconPath hoặc iconUrl."
});

export const foodCatalogParamsSchema = z.object({ foodCatalogId: z.string().uuid() }).strict();
export const setFoodCatalogMarkSchema = z.object({ isMarked: z.boolean() }).strict();

export type CreateFoodCatalogItemInput = z.infer<typeof createFoodCatalogItemSchema>;
export type SetFoodCatalogMarkInput = z.infer<typeof setFoodCatalogMarkSchema>;
