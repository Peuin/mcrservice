import type { FastifyPluginAsync } from "fastify";
import { notImplemented } from "../../shared/not-implemented.js";

export const feedRoutes: FastifyPluginAsync = async (app) => {
  for (const path of ["/home-feed", "/home-feed/*", "/feed/home-feed", "/feed/home-feed/*"]) {
    app.route({ method: ["GET", "POST"], url: path, handler: (_, reply) => notImplemented("home feed", reply) });
  }
  for (const name of ["journal", "stories", "food-catalog"]) {
    for (const path of [`/${name}`, `/feed/${name}`]) {
      app.get(path, (_, reply) => notImplemented(name, reply));
    }
  }
};
