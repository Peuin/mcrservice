import type { FastifyRequest } from "fastify";
import { callEdgeFunction, type EdgeFunctionResult } from "../../shared/edge-function-proxy.js";
import type { CreateCommentInput, CreatePostInput, FeedQuery, ToggleLoveInput } from "./schemas.js";

type FeedContext = Pick<FastifyRequest, "method" | "headers" | "id">;

function callFeed(context: FeedContext, functionPath: string, options: {
  method?: "GET" | "POST";
  query?: Record<string, unknown>;
  body?: unknown;
} = {}): Promise<EdgeFunctionResult> {
  return callEdgeFunction(context, {
    functionName: "home-feed",
    functionPath,
    method: options.method ?? "GET",
    query: options.query,
    body: options.body
  });
}

export function listFeed(context: FeedContext, query: FeedQuery) {
  return callFeed(context, "", { query });
}

export function createPost(context: FeedContext, input: CreatePostInput) {
  return callFeed(context, "post", { method: "POST", body: input });
}

export function getPost(context: FeedContext, postId: string) {
  return callFeed(context, "post", { query: { postId } });
}

export function listComments(context: FeedContext, postId: string) {
  return callFeed(context, "comments", { query: { postId } });
}

export function createComment(context: FeedContext, postId: string, input: CreateCommentInput) {
  return callFeed(context, "comment", { method: "POST", body: { ...input, postId } });
}

export function createReply(context: FeedContext, postId: string, parentCommentId: string, input: CreateCommentInput) {
  return callFeed(context, "comment", { method: "POST", body: { ...input, postId, parentCommentId } });
}

export function togglePostLove(context: FeedContext, postId: string, input: ToggleLoveInput) {
  return callFeed(context, "love", { method: "POST", body: { ...input, postId } });
}

export function listPostReactions(context: FeedContext, postId: string) {
  return callFeed(context, "reactions", { query: { targetType: "post", targetId: postId } });
}

export function toggleCommentLove(context: FeedContext, commentId: string, input: ToggleLoveInput) {
  return callFeed(context, "comment-love", { method: "POST", body: { ...input, commentId } });
}

export function listCommentReactions(context: FeedContext, commentId: string) {
  return callFeed(context, "reactions", { query: { targetType: "comment", targetId: commentId } });
}
