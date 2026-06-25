import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { HandlerResult } from "../../../shared/handler-dispatch.js";
import { createFoodCatalogItemSchema, foodCatalogParamsSchema, setFoodCatalogMarkSchema } from "./schemas.js";
import { createFoodCatalogItem, listFoodCatalog, setFoodCatalogMark } from "./service.js";
import { createFoodCatalogItemDocs, listFoodCatalogDocs, setFoodCatalogMarkDocs } from "./swagger.js";

function invalid(reply: FastifyReply, details: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu Food Catalog không hợp lệ.", details });
}
function send(reply: FastifyReply, result: HandlerResult) { return reply.code(result.status).send(result.payload); }
function issues(...results: Array<{ success: boolean; error?: { flatten(): unknown } }>) {
  return results.find((result) => !result.success)?.error?.flatten() ?? null;
}

export const foodCatalogRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/gov-data/food-catalog", { schema: listFoodCatalogDocs }, async (request, reply) =>
    send(reply, await listFoodCatalog(request)));
  app.post("/api/v1/gov-data/food-catalog", { schema: createFoodCatalogItemDocs }, async (request, reply) => {
    const parsed = createFoodCatalogItemSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const result = await createFoodCatalogItem(request, parsed.data);
    return result.status === 200 ? reply.code(201).send(result.payload) : send(reply, result);
  });
  app.patch("/api/v1/gov-data/food-catalog/:foodCatalogId/mark", { schema: setFoodCatalogMarkDocs }, async (request, reply) => {
    const params = foodCatalogParamsSchema.safeParse(request.params);
    const body = setFoodCatalogMarkSchema.safeParse(request.body);
    return params.success && body.success
      ? send(reply, await setFoodCatalogMark(request, params.data.foodCatalogId, body.data))
      : invalid(reply, issues(params, body));
  });
};
