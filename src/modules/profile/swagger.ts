const json = { type: "object", additionalProperties: true } as const;
const security = [{ bearerAuth: [] }] as const;
const refresh = { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } as const;

function docs(summary: string) {
  return { tags: ["Profile"], summary, security, response: { 200: json, 400: json, 401: json, 404: json } } as const;
}
export const getCurrentProfileDocs = { ...docs("Hồ sơ hiện tại hoặc tìm theo username"), querystring: {
  type: "object", additionalProperties: false, properties: {
    username: { type: "string", pattern: "^[a-zA-Z0-9_@]{3,31}$" }, refresh
  }
}} as const;
export const getProfileByIdDocs = { ...docs("Hồ sơ theo user ID"), params: {
  type: "object", required: ["userId"], properties: { userId: { type: "string", format: "uuid" } }
}, querystring: { type: "object", additionalProperties: false, properties: { refresh } }} as const;
export const updateProfileDocs = { ...docs("Cập nhật hồ sơ hiện tại"), body: {
  type: "object", additionalProperties: false, required: ["displayName", "username"], properties: {
    displayName: { type: "string", minLength: 1, maxLength: 100 },
    username: { type: "string", pattern: "^@?[a-zA-Z0-9_]{3,30}$" },
    bio: { type: "string", maxLength: 1000 }, podcastUrl: { type: "string", maxLength: 2048 },
    showInstagramBadge: { type: "boolean", default: true }, showRecentViews: { type: "boolean", default: false },
    isPrivate: { type: "boolean", default: false }
  }
}} as const;
