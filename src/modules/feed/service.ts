import type { FastifyRequest } from "fastify";
import { callHandler, type HandlerResult } from "../../shared/handler-dispatch.js";
import type { CreateCommentInput, CreatePostInput, FeedQuery, ToggleLoveInput } from "./schemas.js";

type FeedContext = Pick<FastifyRequest, "method" | "headers" | "id">;

function callFeed(context: FeedContext, path: string, options: {
  method?: "GET" | "POST";
  query?: Record<string, unknown>;
  body?: unknown;
} = {}): Promise<HandlerResult> {
  return callHandler(context, {
    name: "home-feed",
    path,
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

export function listMutualFriends(context: FeedContext, query: Record<string, unknown>) {
  return callFeed(context, "friends", { query });
}

export function getTopicHotStatus(context: FeedContext, query: Record<string, unknown>) {
  return callFeed(context, "topic-hot", { query });
}

export function listFrames(context: FeedContext) {
  return callFeed(context, "frames");
}

export function saveFrame(context: FeedContext, body: Record<string, unknown>) {
  return callFeed(context, "frames", { method: "POST", body });
}

export function setDefaultFrame(context: FeedContext, body: Record<string, unknown>) {
  return callFeed(context, "frames/default", { method: "POST", body });
}
