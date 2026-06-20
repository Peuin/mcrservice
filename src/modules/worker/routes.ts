import type { FastifyPluginAsync } from "fastify";
import { env } from "../../config/env.js";
import { proxyEdgeFunction } from "../../shared/edge-function-proxy.js";

export const workerRoutes: FastifyPluginAsync = async (app) => {
  app.post("/internal/workers/feed-cache/warm", (request, reply) => {
    if (!env.HOME_FEED_WARM_SECRET) {
      return reply.code(503).send({ success: false, code: "WARM_SECRET_NOT_CONFIGURED", message: "Feed cache worker is not configured." });
    }
    return proxyEdgeFunction(request, reply, {
      functionName: "home-feed-warm", method: "POST", body: request.body,
      internalSecret: env.HOME_FEED_WARM_SECRET
    });
  });

  app.post("/home-feed-warm", (request, reply) => proxyEdgeFunction(request, reply, {
    functionName: "home-feed-warm", method: "POST", body: request.body,
    internalSecret: env.HOME_FEED_WARM_SECRET
  }));
  app.post("/worker/home-feed-warm", (request, reply) => proxyEdgeFunction(request, reply, {
    functionName: "home-feed-warm", method: "POST", body: request.body,
    internalSecret: env.HOME_FEED_WARM_SECRET
  }));
  app.post("/internal/workers/search-cache/warm", (request, reply) => {
    if (!env.APP_SEARCH_WARM_SECRET) {
      return reply.code(503).send({ success: false, code: "WARM_SECRET_NOT_CONFIGURED", message: "Search cache worker is not configured." });
    }
    return proxyEdgeFunction(request, reply, { functionName: "app-search-warm", method: "POST", body: request.body,
      internalSecret: env.APP_SEARCH_WARM_SECRET });
  });
  for (const path of ["/app-search-warm", "/worker/app-search-warm"]) {
    app.post(path, (request, reply) => proxyEdgeFunction(request, reply, { functionName: "app-search-warm", method: "POST",
      body: request.body, internalSecret: env.APP_SEARCH_WARM_SECRET }));
  }
  app.post("/internal/workers/notification-push", (request, reply) => {
    if (!env.NOTIFICATION_PUSH_SECRET) {
      return reply.code(503).send({ success: false, code: "PUSH_SECRET_NOT_CONFIGURED", message: "Notification push worker is not configured." });
    }
    return proxyEdgeFunction(request, reply, { functionName: "notification-push", method: "POST", body: request.body,
      internalSecret: env.NOTIFICATION_PUSH_SECRET, internalSecretHeader: "x-push-secret" });
  });
  app.post("/notification-push", (request, reply) => proxyEdgeFunction(request, reply, {
    functionName: "notification-push", method: "POST", body: request.body,
    internalSecret: env.NOTIFICATION_PUSH_SECRET, internalSecretHeader: "x-push-secret"
  }));
};
