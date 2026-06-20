import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { proxyEdgeFunction, type EdgeFunctionResult } from "../../shared/edge-function-proxy.js";
import { commentParamsSchema, createCommentSchema, createPostSchema, feedQuerySchema, postParamsSchema, replyParamsSchema, toggleLoveSchema } from "./schemas.js";
import { createComment, createPost, createReply, getPost, listCommentReactions, listComments, listFeed, listPostReactions, toggleCommentLove, togglePostLove } from "./service.js";
import { createCommentDocs, createPostDocs, createReplyDocs, getPostDocs, listCommentReactionsDocs, listCommentsDocs, listFeedDocs, listPostReactionsDocs, toggleCommentLoveDocs, togglePostLoveDocs } from "./swagger.js";

function invalid(reply: FastifyReply, error: unknown) {
  return reply.code(400).send({ success: false, code: "VALIDATION_ERROR", message: "Dữ liệu feed không hợp lệ.", details: error });
}
function send(reply: FastifyReply, result: EdgeFunctionResult) {
  return reply.code(result.status).send(result.payload);
}
function issues(...results: Array<{ success: boolean; error?: { flatten(): unknown } }>) {
  return results.find((result) => !result.success)?.error?.flatten() ?? null;
}

export const feedRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/feed", { schema: listFeedDocs }, async (request, reply) => {
    const parsed = feedQuerySchema.safeParse(request.query);
    return parsed.success ? send(reply, await listFeed(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.post("/api/v1/posts", { schema: createPostDocs }, async (request, reply) => {
    const parsed = createPostSchema.safeParse(request.body);
    return parsed.success ? send(reply, await createPost(request, parsed.data)) : invalid(reply, parsed.error.flatten());
  });
  app.get("/api/v1/posts/:postId", { schema: getPostDocs }, async (request, reply) => {
    const parsed = postParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await getPost(request, parsed.data.postId)) : invalid(reply, parsed.error.flatten());
  });
  app.get("/api/v1/posts/:postId/comments", { schema: listCommentsDocs }, async (request, reply) => {
    const parsed = postParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await listComments(request, parsed.data.postId)) : invalid(reply, parsed.error.flatten());
  });
  app.post("/api/v1/posts/:postId/comments", { schema: createCommentDocs }, async (request, reply) => {
    const params = postParamsSchema.safeParse(request.params); const body = createCommentSchema.safeParse(request.body);
    return params.success && body.success ? send(reply, await createComment(request, params.data.postId, body.data)) : invalid(reply, issues(params, body));
  });
  app.post("/api/v1/posts/:postId/comments/:commentId/replies", { schema: createReplyDocs }, async (request, reply) => {
    const params = replyParamsSchema.safeParse(request.params); const body = createCommentSchema.safeParse(request.body);
    return params.success && body.success ? send(reply, await createReply(request, params.data.postId, params.data.commentId, body.data)) : invalid(reply, issues(params, body));
  });
  app.post("/api/v1/posts/:postId/reactions/love", { schema: togglePostLoveDocs }, async (request, reply) => {
    const params = postParamsSchema.safeParse(request.params); const body = toggleLoveSchema.safeParse(request.body);
    return params.success && body.success ? send(reply, await togglePostLove(request, params.data.postId, body.data)) : invalid(reply, issues(params, body));
  });
  app.get("/api/v1/posts/:postId/reactions", { schema: listPostReactionsDocs }, async (request, reply) => {
    const parsed = postParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await listPostReactions(request, parsed.data.postId)) : invalid(reply, parsed.error.flatten());
  });
  app.post("/api/v1/comments/:commentId/reactions/love", { schema: toggleCommentLoveDocs }, async (request, reply) => {
    const params = commentParamsSchema.safeParse(request.params); const body = toggleLoveSchema.safeParse(request.body);
    return params.success && body.success ? send(reply, await toggleCommentLove(request, params.data.commentId, body.data)) : invalid(reply, issues(params, body));
  });
  app.get("/api/v1/comments/:commentId/reactions", { schema: listCommentReactionsDocs }, async (request, reply) => {
    const parsed = commentParamsSchema.safeParse(request.params);
    return parsed.success ? send(reply, await listCommentReactions(request, parsed.data.commentId)) : invalid(reply, parsed.error.flatten());
  });

  for (const path of ["/home-feed", "/home-feed/*", "/feed/home-feed", "/feed/home-feed/*"]) {
    app.route({ method: ["GET", "POST"], url: path, schema: { hide: true }, handler: (request, reply) => {
      const suffix = request.url.split("?")[0]?.split("/home-feed/")[1] ?? "";
      return proxyEdgeFunction(request, reply, { functionName: "home-feed", functionPath: suffix,
        query: asObject(request.query), body: request.body, method: request.method as "GET" | "POST" });
    }});
  }
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
