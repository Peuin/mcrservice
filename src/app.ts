import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { localizeDirectPayload } from "./shared/api-i18n.js";
import { authRoutes } from "./modules/auth/routes.js";
import { aiAskRoutes } from "./modules/aiask/routes.js";
import { feedRoutes } from "./modules/feed/routes.js";
import { journalRoutes } from "./modules/journal/routes.js";
import { mapRoutes } from "./modules/map/routes.js";
import { foodCatalogRoutes } from "./modules/gov-data/food-catalog/routes.js";
import { friendRoutes } from "./modules/gov-data/friends/routes.js";
import { searchRoutes } from "./modules/search/routes.js";
import { storyRoutes } from "./modules/stories/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { profileRoutes } from "./modules/profile/routes.js";
import { workerRoutes } from "./modules/worker/routes.js";

export async function buildApp() {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  app.addHook("preSerialization", (request, reply, payload, done) => {
    done(null, localizeDirectPayload(request, reply.statusCode, payload));
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((value) => value.trim())
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "MCR Service API", version: "0.1.0" },
      servers: [{ url: "http://localhost:8080", description: "Local" }],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } }
    }
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/health", async () => ({ status: "ok", service: "mcrservice" }));
  await app.register(authRoutes);
  await app.register(aiAskRoutes);
  await app.register(profileRoutes);
  await app.register(feedRoutes);
  await app.register(journalRoutes);
  await app.register(mapRoutes);
  await app.register(foodCatalogRoutes);
  await app.register(friendRoutes);
  await app.register(searchRoutes);
  await app.register(storyRoutes);
  await app.register(notificationRoutes);
  await app.register(workerRoutes);

  return app;
}
