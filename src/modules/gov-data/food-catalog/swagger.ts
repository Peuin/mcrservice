const json = { type: "object", additionalProperties: true } as const;
const security = [{ bearerAuth: [] }] as const;
function docs(summary: string) {
  return { tags: ["Gov Data - Food Catalog"], summary, security, response: { 200: json, 400: json, 401: json } } as const;
}
export const listFoodCatalogDocs = docs("Danh sách Food Catalog và trạng thái đánh dấu");
export const createFoodCatalogItemDocs = { ...docs("Tạo Food Catalog item cá nhân"), body: {
  type: "object", additionalProperties: false, required: ["nameVi", "nameEn"], properties: {
    nameVi: { type: "string", minLength: 1, maxLength: 200 }, nameEn: { type: "string", minLength: 1, maxLength: 200 },
    slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 200 },
    iconBucket: { type: "string", minLength: 1, maxLength: 100, default: "food-catalog" },
    iconPath: { type: "string", maxLength: 2048 }, iconUrl: { type: "string", format: "uri", maxLength: 2048 }
  }
}, response: { 201: json, 400: json, 401: json }} as const;
export const setFoodCatalogMarkDocs = { ...docs("Bật hoặc tắt đánh dấu món"), params: {
  type: "object", required: ["foodCatalogId"], properties: { foodCatalogId: { type: "string", format: "uuid" } }
}, body: { type: "object", additionalProperties: false, required: ["isMarked"], properties: { isMarked: { type: "boolean" } } }} as const;
