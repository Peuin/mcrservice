import type { FastifyPluginAsync } from "fastify";
import { notImplemented } from "../../shared/not-implemented.js";

export const searchRoutes: FastifyPluginAsync = async (app) => {
  for (const name of ["app-search", "goong-place-search", "vietmap-place-search"]) {
    for (const path of [`/${name}`, `/search/${name}`]) {
      app.get(path, (_, reply) => notImplemented(name, reply));
    }
  }
};
