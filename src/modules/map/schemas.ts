import { z } from "zod";

export const placeSearchSchema = z.object({
  query: z.string().trim().max(300).default(""),
  limit: z.coerce.number().int().min(1).max(20).default(12),
  nearLat: z.coerce.number().min(-90).max(90).optional(),
  nearLng: z.coerce.number().min(-180).max(180).optional(),
  localOnly: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).default(false)
}).strict().superRefine((value, context) => {
  if ((value.nearLat === undefined) !== (value.nearLng === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nearLat"], message: "nearLat và nearLng phải đi cùng nhau." });
  }
  if (!value.query && value.nearLat === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["query"], message: "Cần query hoặc cặp tọa độ gần." });
  }
});

export type PlaceSearchInput = z.infer<typeof placeSearchSchema>;
