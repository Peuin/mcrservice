import type { FastifyRequest } from "fastify";
import { callEdgeFunction } from "../../shared/edge-function-proxy.js";
import type { PlaceSearchInput } from "./schemas.js";

type MapContext = Pick<FastifyRequest, "method" | "headers" | "id">;

function searchPlaces(context: MapContext, input: PlaceSearchInput) {
  return callEdgeFunction(context, { functionName: "goong-place-search", method: "GET", query: {
    query: input.query, limit: input.limit, nearLat: input.nearLat, nearLng: input.nearLng, localOnly: input.localOnly
  }});
}

export function searchGoongPlaces(context: MapContext, input: PlaceSearchInput) {
  return searchPlaces(context, input);
}
