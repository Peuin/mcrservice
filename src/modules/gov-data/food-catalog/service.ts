import type { FastifyRequest } from "fastify";
import { callEdgeFunction } from "../../../shared/edge-function-proxy.js";
import type { CreateFoodCatalogItemInput, SetFoodCatalogMarkInput } from "./schemas.js";

type FoodCatalogContext = Pick<FastifyRequest, "method" | "headers" | "id">;

export function listFoodCatalog(context: FoodCatalogContext) {
  return callEdgeFunction(context, { functionName: "food-catalog", method: "GET" });
}

export function createFoodCatalogItem(context: FoodCatalogContext, input: CreateFoodCatalogItemInput) {
  return callEdgeFunction(context, { functionName: "food-catalog", method: "POST", body: { action: "create", ...input } });
}

export function setFoodCatalogMark(context: FoodCatalogContext, foodCatalogId: string, input: SetFoodCatalogMarkInput) {
  return callEdgeFunction(context, { functionName: "food-catalog", method: "POST", body: {
    action: "set_mark", foodCatalogId, isMarked: input.isMarked
  }});
}
