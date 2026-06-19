import { supabaseAdmin } from "./supabase.js";

type JsonObject = Record<string, unknown>;

export type AuditEvent = {
  eventType: string;
  action: "insert" | "update" | "delete";
  schemaName: string;
  tableName: string;
  recordId?: string | null;
  actorId?: string | null;
  actorType?: "user" | "system" | "service";
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  oldData?: JsonObject | null;
  newData?: JsonObject | null;
  metadata?: JsonObject;
};

/**
 * Writes an internal backend event through audit.log_event().
 * The audit schema must be exposed to PostgREST for service_role only.
 */
export async function logAuditEvent(event: AuditEvent): Promise<string> {
  if (!supabaseAdmin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured for audit logging.");
  }

  const { data, error } = await supabaseAdmin.schema("audit").rpc("log_event", {
    p_event_type: event.eventType,
    p_action: event.action,
    p_schema_name: event.schemaName,
    p_table_name: event.tableName,
    p_record_id: event.recordId ?? null,
    p_actor_id: event.actorId ?? null,
    p_actor_type: event.actorType ?? "system",
    p_source: "api",
    p_request_id: event.requestId ?? null,
    p_ip_address: event.ipAddress ?? null,
    p_user_agent: event.userAgent ?? null,
    p_old_data: event.oldData ?? null,
    p_new_data: event.newData ?? null,
    p_metadata: event.metadata ?? {}
  });

  if (error) throw error;
  if (typeof data !== "string" || data.length === 0) {
    throw new Error("audit.log_event() did not return an event id.");
  }
  return data;
}
