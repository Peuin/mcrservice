import { z } from "zod";

const mealPeriodSchema = z.enum(["earlyMorning", "breakfast", "lunch", "afternoon", "dinner", "lateNight"]);
const tasteSchema = z.enum(["any", "spicy", "mild", "sweet", "salty"]);

export const mealFiltersSchema = z.object({
  local_time: z.string().datetime({ offset: true }).optional(),
  meal_period: mealPeriodSchema,
  budget_thousands: z.number().nonnegative().max(100000).nullable().optional(),
  taste: tasteSchema.default("any"),
  max_distance_km: z.number().positive().max(1000).nullable().optional()
}).strict();

export const askPeuinSchema = z.object({
  session_id: z.string().uuid().optional(),
  query: z.string().trim().min(1).max(4000),
  meal_filters: mealFiltersSchema.optional()
}).strict();

export const recommendationFeedbackSchema = z.object({
  recommendation_id: z.string().uuid(),
  feedback: z.enum(["like", "dislike", "ate", "not_relevant", "too_expensive", "too_far", "suggest_again"]),
  feedback_reason: z.string().trim().max(1000).default("")
}).strict();

export type AskPeuinInput = z.infer<typeof askPeuinSchema>;
export type RecommendationFeedbackInput = z.infer<typeof recommendationFeedbackSchema>;

const personalityHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().trim().min(1).max(12000)
}).strict();

export const personalityReplySchema = z.object({
  query: z.string().trim().min(1).max(4000),
  preferred_name: z.string().trim().min(1).max(100).default("bạn"),
  history: z.array(personalityHistoryMessageSchema).max(20).default([]),
  profile_context: z.record(z.unknown()).default({}),
  memory_context: z.record(z.unknown()).default({}),
  public_feed_candidates: z.array(z.record(z.unknown())).max(60).default([]),
  should_recommend_food: z.boolean().default(false),
  meal_filters: mealFiltersSchema.nullable().optional(),
  meal_filters_prompt: z.string().trim().max(4000).default("")
}).strict();

export type PersonalityReplyInput = z.infer<typeof personalityReplySchema>;
