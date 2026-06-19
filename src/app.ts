import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { authRoutes } from "./modules/auth/routes.js";
import { feedRoutes } from "./modules/feed/routes.js";
import { searchRoutes } from "./modules/search/routes.js";
import { userRoutes } from "./modules/user/routes.js";
import { workerRoutes } from "./modules/worker/routes.js";

export async function buildApp() {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((value) => value.trim())
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "MCR Service API", version: "0.1.0" },
      servers: [{ url: "http://localhost:8080", description: "Local" }]
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/health", async () => ({ status: "ok", service: "mcrservice" }));
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(feedRoutes);
  await app.register(searchRoutes);
  await app.register(workerRoutes);

  return app;
}
