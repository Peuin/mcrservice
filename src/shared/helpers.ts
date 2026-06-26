export function stringValue(value: unknown): string {
  return value == null ? "" : String(value);
}

export function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(stringValue(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function errorMessage(error: unknown, fallback = "Request failed."): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}
