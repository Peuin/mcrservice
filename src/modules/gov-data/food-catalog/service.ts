import type { FastifyRequest } from "fastify";
import { callHandler } from "../../../shared/handler-dispatch.js";
import type { CreateFoodCatalogItemInput, SetFoodCatalogMarkInput } from "./schemas.js";

type FoodCatalogContext = Pick<FastifyRequest, "method" | "headers" | "id">;

export function listFoodCatalog(context: FoodCatalogContext) {
  return callHandler(context, { name: "food-catalog", method: "GET" });
}

export function createFoodCatalogItem(context: FoodCatalogContext, input: CreateFoodCatalogItemInput) {
  return callHandler(context, { name: "food-catalog", method: "POST", body: { action: "create", ...input } });
}

export function setFoodCatalogMark(context: FoodCatalogContext, foodCatalogId: string, input: SetFoodCatalogMarkInput) {
  return callHandler(context, {
    name: "food-catalog",
    method: "POST",
    body: { action: "set_mark", foodCatalogId, isMarked: input.isMarked }
  });
}
