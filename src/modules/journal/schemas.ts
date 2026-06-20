import { z } from "zod";

const timezoneSchema = z.string().trim().min(1).max(100).default("Asia/Ho_Chi_Minh");

export const monthMarkersQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1).max(12),
  timezone: timezoneSchema
}).strict();

export const dayEntriesQuerySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: timezoneSchema
}).strict().superRefine((value, context) => {
  const date = new Date(`${value.day}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.day) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["day"], message: "Ngày journal không hợp lệ." });
  }
});

export type MonthMarkersQuery = z.infer<typeof monthMarkersQuerySchema>;
export type DayEntriesQuery = z.infer<typeof dayEntriesQuerySchema>;
