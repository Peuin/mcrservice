import type { FastifyPluginAsync } from "fastify";
import { notImplemented } from "../../shared/not-implemented.js";

export const workerRoutes: FastifyPluginAsync = async (app) => {
  for (const name of ["home-feed-warm", "app-search-warm"]) {
    for (const path of [`/${name}`, `/worker/${name}`]) {
      app.post(path, (_, reply) => notImplemented(name, reply));
    }
  }
};
