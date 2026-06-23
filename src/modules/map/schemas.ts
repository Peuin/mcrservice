import { z } from "zod";

function emptyToUndefined(value: unknown): unknown {
  return value === "" || value === null || value === undefined ? undefined : value;
}

function normalizePlaceSearchQuery(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const query = input as Record<string, unknown>;
  return {
    query: query.query ?? query.text,
    limit: query.limit,
    nearLat: query.nearLat ?? query.near_lat ?? query.lat,
    nearLng: query.nearLng ?? query.near_lng ?? query.lng,
    localOnly: query.localOnly ?? query.local_only,
  };
}

const optionalCoordinate = z.preprocess(
  emptyToUndefined,
  z.coerce.number().optional(),
);

export const placeSearchSchema = z.preprocess(
  normalizePlaceSearchQuery,
  z.object({
    query: z.string().trim().max(300).default(""),
    limit: z.coerce.number().int().min(1).max(20).default(12),
    nearLat: optionalCoordinate.refine(
      (value) => value === undefined || (value >= -90 && value <= 90),
      { message: "nearLat phải nằm trong khoảng -90 đến 90." },
    ),
    nearLng: optionalCoordinate.refine(
      (value) => value === undefined || (value >= -180 && value <= 180),
      { message: "nearLng phải nằm trong khoảng -180 đến 180." },
    ),
    localOnly: z.union([
      z.boolean(),
      z.enum(["true", "false"]).transform((value) => value === "true"),
    ]).default(false),
  }).strict().superRefine((value, context) => {
    if ((value.nearLat === undefined) !== (value.nearLng === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nearLat"],
        message: "nearLat và nearLng phải đi cùng nhau.",
      });
    }
    if (!value.query && value.nearLat === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["query"],
        message: "Cần query hoặc cặp tọa độ gần.",
      });
    }
  }),
);

export type PlaceSearchInput = z.infer<typeof placeSearchSchema>;
