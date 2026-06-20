const json = { type: "object", additionalProperties: true } as const;
const security = [{ bearerAuth: [] }] as const;
const mealFilters = { type: "object", additionalProperties: false, required: ["meal_period"], properties: {
  local_time: { type: "string", format: "date-time" },
  meal_period: { type: "string", enum: ["earlyMorning", "breakfast", "lunch", "afternoon", "dinner", "lateNight"] },
  budget_thousands: { type: ["number", "null"], minimum: 0, maximum: 100000 },
  taste: { type: "string", enum: ["any", "spicy", "mild", "sweet", "salty"] },
  max_distance_km: { type: ["number", "null"], exclusiveMinimum: 0, maximum: 1000 }
}} as const;

function docs(summary: string) {
  return { tags: ["AI Ask Peuin"], summary, security, response: { 200: json, 400: json, 401: json, 502: json } } as const;
}
export const askPeuinDocs = { ...docs("Chat và nhận gợi ý ăn uống từ Peuin"), body: {
  type: "object", additionalProperties: false, required: ["query"], properties: {
    session_id: { type: "string", format: "uuid" }, query: { type: "string", minLength: 1, maxLength: 4000 }, meal_filters: mealFilters
  }
}} as const;
export const todaySessionDocs = docs("Lấy hoặc tạo phiên chat hôm nay");
export const recommendationFeedbackDocs = { ...docs("Gửi phản hồi cho recommendation"), body: {
  type: "object", additionalProperties: false, required: ["recommendation_id", "feedback"], properties: {
    recommendation_id: { type: "string", format: "uuid" },
    feedback: { type: "string", enum: ["like", "dislike", "ate", "not_relevant", "too_expensive", "too_far", "suggest_again"] },
    feedback_reason: { type: "string", maxLength: 1000 }
  }
}} as const;

const contextObject = { type: "object", additionalProperties: true } as const;
export const personalityReplyDocs = { ...docs("Tạo câu trả lời trực tiếp từ Personality AI"), body: {
  type: "object", additionalProperties: false, required: ["query"], properties: {
    query: { type: "string", minLength: 1, maxLength: 4000 }, preferred_name: { type: "string", minLength: 1, maxLength: 100 },
    history: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["role", "content"], properties: {
      role: { type: "string", enum: ["user", "assistant", "system"] }, content: { type: "string", minLength: 1, maxLength: 12000 }
    }}},
    profile_context: contextObject, memory_context: contextObject,
    public_feed_candidates: { type: "array", maxItems: 60, items: contextObject },
    should_recommend_food: { type: "boolean", default: false }, meal_filters: { anyOf: [mealFilters, { type: "null" }] },
    meal_filters_prompt: { type: "string", maxLength: 4000 }
  }
}} as const;
export const personalityHealthDocs = docs("Kiểm tra nguồn personality markdown");
