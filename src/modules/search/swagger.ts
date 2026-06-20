const errorResponse = { type: "object", additionalProperties: true } as const;
const jsonResponse = { type: "object", additionalProperties: true } as const;
const security = [{ bearerAuth: [] }] as const;
const refresh = { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } as const;

function docs(summary: string) {
  return { tags: ["Search"], summary, security, response: { 200: jsonResponse, 400: errorResponse, 401: errorResponse } } as const;
}

export const discoverDocs = { ...docs("Tìm người dùng, địa điểm và món ăn"), querystring: {
  type: "object", additionalProperties: false, properties: {
    q: { type: "string", maxLength: 200, default: "" }, limit: { type: "integer", minimum: 1, maximum: 20, default: 8 }, refresh
  }
}} as const;
export const searchPostsDocs = { ...docs("Tìm bài viết theo địa điểm hoặc món ăn"), querystring: {
  type: "object", additionalProperties: false, properties: {
    placeId: { type: "string", format: "uuid" }, food: { type: "string", minLength: 1, maxLength: 200 },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }, refresh
  }
}} as const;
export const listRecentDocs = { ...docs("Danh sách lịch sử tìm kiếm"), querystring: {
  type: "object", additionalProperties: false, properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }, refresh
  }
}} as const;
export const saveRecentDocs = { ...docs("Lưu một mục lịch sử tìm kiếm"), body: {
  type: "object", additionalProperties: false, required: ["searchType", "query", "targetId", "title"], properties: {
    searchType: { type: "string", enum: ["user", "place", "food"] }, query: { type: "string", minLength: 1, maxLength: 200 },
    targetId: { type: "string", minLength: 1, maxLength: 200 }, title: { type: "string", minLength: 1, maxLength: 300 },
    subtitle: { type: "string", maxLength: 500 }, imageUrl: { type: "string", maxLength: 2048 }
  }
}} as const;
export const deleteRecentDocs = { ...docs("Xóa một mục lịch sử tìm kiếm"), params: {
  type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } }
}} as const;
export const clearRecentDocs = docs("Xóa toàn bộ lịch sử tìm kiếm");
