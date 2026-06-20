import type { FastifyRequest } from "fastify";
import { callEdgeFunction } from "../../shared/edge-function-proxy.js";
import type { ProfileQuery, UpdateProfileInput } from "./schemas.js";

type ProfileContext = Pick<FastifyRequest, "method" | "headers" | "id">;

export function getProfile(context: ProfileContext, query: ProfileQuery) {
  return callEdgeFunction(context, { functionName: "profile", method: "GET", query });
}

export function getProfileById(context: ProfileContext, userId: string, refresh?: string | number | boolean) {
  return getProfile(context, { userId, ...(refresh === undefined ? {} : { refresh }) });
}

export function updateCurrentProfile(context: ProfileContext, input: UpdateProfileInput) {
  return callEdgeFunction(context, { functionName: "profile", method: "POST", body: input });
}
