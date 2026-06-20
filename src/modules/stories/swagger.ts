const json = { type: "object", additionalProperties: true } as const;
const security = [{ bearerAuth: [] }] as const;
function docs(summary: string) {
  return { tags: ["Stories"], summary, security, response: { 200: json, 400: json, 401: json } } as const;
}
export const listStoriesDocs = { ...docs("Danh sách story đang hiển thị"), querystring: {
  type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 80, default: 40 } }
}} as const;
export const archiveStoriesDocs = docs("Kho story của người dùng hiện tại");
export const createStoryDocs = { ...docs("Tạo story ảnh mới"), body: {
  type: "object", additionalProperties: false, required: ["mediaBase64"], properties: {
    mediaBase64: { type: "string", minLength: 4, maxLength: 20000000 },
    contentType: { type: "string", enum: ["image/jpeg", "image/png", "image/webp", "image/heic"], default: "image/jpeg" },
    caption: { type: "string", maxLength: 1000 },
    textOverlay: { anyOf: [{ type: "object", additionalProperties: false, required: ["text", "color"], properties: {
      text: { type: "string", minLength: 1, maxLength: 500 }, style: { type: "string", enum: ["modern", "classic", "signature", "editor", "poster"] },
      color: { type: "integer" }, backgroundColor: { type: ["integer", "null"] }, isItalic: { type: "boolean" },
      fontSize: { type: "number", minimum: 8, maximum: 160 }, textAlign: { type: "string", enum: ["left", "right", "center", "justify", "start", "end"] },
      hasShadow: { type: "boolean" }, offsetX: { type: "number", minimum: -5000, maximum: 5000 }, offsetY: { type: "number", minimum: -5000, maximum: 5000 }
    }}, { type: "null" }] }
  }
}, response: { 201: json, 400: json, 401: json, 413: json }} as const;
