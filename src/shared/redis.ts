import { env } from "../config/env.js";

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
