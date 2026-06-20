const json = { type: "object", additionalProperties: true } as const;
const security = [{ bearerAuth: [] }] as const;
const notificationParams = { type: "object", required: ["notificationId"], properties: { notificationId: { type: "string", format: "uuid" } } } as const;

function docs(summary: string) {
  return { tags: ["Notifications"], summary, security, response: { 200: json, 400: json, 401: json } } as const;
}
export const listNotificationsDocs = { ...docs("Danh sách thông báo"), querystring: { type: "object", additionalProperties: false, properties: {
  limit: { type: "integer", minimum: 1, maximum: 100, default: 30 }, before: { type: "string", format: "date-time" }
}}} as const;
export const markReadDocs = { ...docs("Đánh dấu thông báo đã đọc"), params: notificationParams } as const;
export const markAllReadDocs = docs("Đánh dấu tất cả thông báo đã đọc");
export const muteNotificationDocs = { ...docs("Tắt loại thông báo tương ứng"), params: notificationParams } as const;
export const deleteNotificationDocs = { ...docs("Xóa thông báo"), params: notificationParams } as const;
export const registerPushTokenDocs = { ...docs("Đăng ký push token của thiết bị"), body: {
  type: "object", additionalProperties: false, required: ["token", "platform"], properties: {
    token: { type: "string", minLength: 1, maxLength: 4096 }, platform: { type: "string", enum: ["android", "ios", "macos", "web"] },
    deviceId: { type: "string", maxLength: 255 }, appVersion: { type: "string", maxLength: 100 }
  }
}} as const;
export const unregisterPushTokenDocs = { ...docs("Hủy đăng ký push token"), body: {
  type: "object", additionalProperties: false, required: ["token"], properties: { token: { type: "string", minLength: 1, maxLength: 4096 } }
}} as const;
