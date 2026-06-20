const json = { type: "object", additionalProperties: true } as const;
const security = [{ bearerAuth: [] }] as const;
const timezone = { type: "string", minLength: 1, maxLength: 100, default: "Asia/Ho_Chi_Minh" } as const;

function docs(summary: string) {
  return { tags: ["Journal"], summary, security, response: { 200: json, 400: json, 401: json } } as const;
}
export const monthMarkersDocs = { ...docs("Các ngày có journal trong tháng"), querystring: {
  type: "object", additionalProperties: false, required: ["year", "month"], properties: {
    year: { type: "integer", minimum: 2000, maximum: 2200 }, month: { type: "integer", minimum: 1, maximum: 12 }, timezone
  }
}} as const;
export const dayEntriesDocs = { ...docs("Danh sách journal trong một ngày"), querystring: {
  type: "object", additionalProperties: false, required: ["day"], properties: {
    day: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", examples: ["2026-06-21"] }, timezone
  }
}} as const;
