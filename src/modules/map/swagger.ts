const json = { type: "object", additionalProperties: true } as const;
const security = [{ bearerAuth: [] }] as const;
const querystring = { type: "object", additionalProperties: false, properties: {
  query: { type: "string", maxLength: 300, default: "" }, limit: { type: "integer", minimum: 1, maximum: 20, default: 12 },
  nearLat: { type: "number", minimum: -90, maximum: 90 }, nearLng: { type: "number", minimum: -180, maximum: 180 },
  localOnly: { anyOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }] }
}} as const;
function docs(summary: string) {
  return { tags: ["Map"], summary, security, querystring, response: { 200: json, 400: json, 401: json, 500: json } } as const;
}
export const goongSearchDocs = docs("Tìm địa điểm bằng Goong và dữ liệu local");
