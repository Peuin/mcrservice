import type { ApiResult } from "./api-result.js";

export type PortedRequest = {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  json: () => Promise<unknown>;
};

export function readHeader(headers: Record<string, string | undefined>, name: string): string {
  const value = headers[name.toLowerCase()];
  return value ?? "";
}

export function toPortedRequest(input: {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  body?: unknown;
}): PortedRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(input.headers)) {
    if (Array.isArray(value)) headers[key.toLowerCase()] = value[0];
    else if (typeof value === "string") headers[key.toLowerCase()] = value;
  }

  return {
    method: input.method,
    url: input.url ?? "http://mcrservice.local/",
    headers,
    json: async () => input.body ?? {}
  };
}

export async function invokePorted(
  handler: (request: PortedRequest) => Promise<Response>,
  input: Parameters<typeof toPortedRequest>[0]
): Promise<ApiResult> {
  const response = await handler(toPortedRequest(input));
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: "Invalid JSON response from handler." };
    }
  }
  return { status: response.status, payload };
}
