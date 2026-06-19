import type { FastifyPluginAsync } from "fastify";
import { notImplemented } from "../../shared/not-implemented.js";

export const userRoutes: FastifyPluginAsync = async (app) => {
  for (const path of ["/profile", "/user/profile"]) {
    app.route({ method: ["GET", "POST"], url: path, handler: (_, reply) => notImplemented("profile", reply) });
  }
  for (const path of ["/friends", "/user/friends"]) {
    app.route({ method: ["GET", "POST"], url: path, handler: (_, reply) => notImplemented("friends", reply) });
  }
  for (const path of ["/personality", "/user/personality", "/ask-peuin", "/user/ask-peuin"]) {
    app.post(path, (_, reply) => notImplemented(path.includes("personality") ? "personality" : "ask Peuin", reply));
  }
};
