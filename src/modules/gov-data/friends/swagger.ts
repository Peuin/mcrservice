const json = { type: "object", additionalProperties: true } as const;
const security = [{ bearerAuth: [] }] as const;
const userIdParams = { type: "object", required: ["userId"], properties: { userId: { type: "string", format: "uuid" } } } as const;
const requestIdParams = { type: "object", required: ["requestId"], properties: { requestId: { type: "string", format: "uuid" } } } as const;
function docs(summary: string) {
  return { tags: ["Gov Data - Friends"], summary, security, response: { 200: json, 400: json, 401: json, 404: json } } as const;
}
export const listFriendsDocs = { ...docs("Danh sách bạn bè"), querystring: { type: "object", additionalProperties: false, properties: {
  userId: { type: "string", format: "uuid" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }
}}} as const;
export const listRequestsDocs = { ...docs("Danh sách lời mời kết bạn"), querystring: { type: "object", additionalProperties: false, properties: {
  direction: { type: "string", enum: ["incoming", "outgoing"], default: "incoming" }
}}} as const;
export const statusDocs = { ...docs("Trạng thái quan hệ với người dùng"), params: userIdParams } as const;
export const sendRequestDocs = { ...docs("Gửi lời mời kết bạn"), params: userIdParams, response: { 201: json, 400: json, 401: json } } as const;
export const respondRequestDocs = { ...docs("Chấp nhận hoặc từ chối lời mời"), params: requestIdParams, body: {
  type: "object", additionalProperties: false, required: ["accept"], properties: { accept: { type: "boolean" } }
}} as const;
export const cancelRequestDocs = { ...docs("Hủy lời mời đã gửi"), params: requestIdParams } as const;
export const removeFriendshipDocs = { ...docs("Hủy kết bạn"), params: userIdParams } as const;
export const blockUserDocs = { ...docs("Chặn người dùng"), params: userIdParams } as const;
export const unblockUserDocs = { ...docs("Bỏ chặn người dùng"), params: userIdParams } as const;
