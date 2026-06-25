import type { FastifyRequest } from "fastify";
import { callHandler } from "../../shared/handler-dispatch.js";
import type { DayEntriesQuery, MonthMarkersQuery } from "./schemas.js";

type JournalContext = Pick<FastifyRequest, "method" | "headers" | "id">;

export function getMonthMarkers(context: JournalContext, query: MonthMarkersQuery) {
  return callHandler(context, {
    name: "journal",
    method: "GET",
    query: { action: "month", year: query.year, month: query.month, timezone: query.timezone }
  });
}

export function getDayEntries(context: JournalContext, query: DayEntriesQuery) {
  return callHandler(context, {
    name: "journal",
    method: "GET",
    query: { action: "day", day: query.day, timezone: query.timezone }
  });
}
