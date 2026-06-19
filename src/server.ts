import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = await buildApp();

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Gracefully shutting down");
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Graceful shutdown failed");
    process.exit(1);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
