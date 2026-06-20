import type { FastifyRequest } from "fastify";
import { callEdgeFunction } from "../../shared/edge-function-proxy.js";
import type { DayEntriesQuery, MonthMarkersQuery } from "./schemas.js";

type JournalContext = Pick<FastifyRequest, "method" | "headers" | "id">;

export function getMonthMarkers(context: JournalContext, query: MonthMarkersQuery) {
  return callEdgeFunction(context, {
    functionName: "journal", method: "GET",
    query: { action: "month", year: query.year, month: query.month, timezone: query.timezone }
  });
}

export function getDayEntries(context: JournalContext, query: DayEntriesQuery) {
  return callEdgeFunction(context, {
    functionName: "journal", method: "GET",
    query: { action: "day", day: query.day, timezone: query.timezone }
  });
}
