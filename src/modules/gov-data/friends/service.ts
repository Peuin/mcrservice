import type { FastifyRequest } from "fastify";
import { callHandler } from "../../../shared/handler-dispatch.js";
import type { FriendsQuery, RequestsQuery, RespondRequestInput } from "./schemas.js";

type FriendsContext = Pick<FastifyRequest, "method" | "headers" | "id">;
function get(context: FriendsContext, query: Record<string, unknown>) {
  return callHandler(context, { name: "friends", method: "GET", query });
}
function action(context: FriendsContext, body: Record<string, unknown>) {
  return callHandler(context, { name: "friends", method: "POST", body });
}

export function listFriends(context: FriendsContext, query: FriendsQuery) { return get(context, query); }
export function listFriendRequests(context: FriendsContext, query: RequestsQuery) {
  return get(context, { action: "list_requests", direction: query.direction });
}
export function getFriendshipStatus(context: FriendsContext, targetUserId: string) {
  return get(context, { action: "status", targetUserId });
}
export function sendFriendRequest(context: FriendsContext, targetUserId: string) {
  return action(context, { action: "send_request", targetUserId });
}
export function respondFriendRequest(context: FriendsContext, requestId: string, input: RespondRequestInput) {
  return action(context, { action: "respond_request", requestId, accept: input.accept });
}
export function cancelFriendRequest(context: FriendsContext, requestId: string) {
  return action(context, { action: "cancel_request", requestId });
}
export function removeFriendship(context: FriendsContext, targetUserId: string) {
  return action(context, { action: "remove_friendship", targetUserId });
}
export function blockUser(context: FriendsContext, targetUserId: string) {
  return action(context, { action: "block_user", targetUserId });
}
export function unblockUser(context: FriendsContext, targetUserId: string) {
  return action(context, { action: "unblock_user", targetUserId });
}
