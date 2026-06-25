import { env } from "../config/env.js";

export const AVATAR_STORAGE_BUCKET = "avata";

export async function redisGet<T = unknown>(key: string): Promise<T | null> {
  const redisUrl = env.UPSTASH_REDIS_REST_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return null;

  try {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(["GET", key])
    });
    if (!response.ok) return null;

    const payload = await response.json() as { result?: unknown };
    const result = payload.result;
    return typeof result === "string" ? JSON.parse(result) as T : null;
  } catch (error) {
    console.warn("redis get skipped", error);
    return null;
  }
}

export async function redisSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redisUrl = env.UPSTASH_REDIS_REST_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return;

  try {
    await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(["SET", key, JSON.stringify(value), "EX", String(ttlSeconds)])
    });
  } catch (error) {
    console.warn("redis set skipped", error);
  }
}
