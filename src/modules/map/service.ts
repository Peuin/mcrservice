import type { FastifyRequest } from "fastify";
import { callHandler } from "../../shared/handler-dispatch.js";
import type { PlaceSearchInput } from "./schemas.js";

type MapContext = Pick<FastifyRequest, "method" | "headers" | "id">;

export function searchGoongPlaces(context: MapContext, input: PlaceSearchInput) {
  return callHandler(context, {
    name: "goong-place-search",
    method: "GET",
    query: {
      query: input.query,
      limit: input.limit,
      nearLat: input.nearLat,
      nearLng: input.nearLng,
      localOnly: input.localOnly
    },
    forwardClientAuth: false
  });
}
