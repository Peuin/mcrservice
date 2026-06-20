import type { FastifyRequest } from "fastify";

type Locale = "vi" | "en";
type Json = Record<string, unknown>;

const messages = {
  vi: {
    SUCCESS: "Thành công.",
    EMPTY_FEED: "Hiện tại không có tin.",
    EMPTY_NOTIFICATIONS: "Hiện tại không có thông báo.",
    EMPTY_COMMENTS: "Hiện tại chưa có bình luận.",
    EMPTY_REACTIONS: "Hiện tại chưa có lượt thích.",
    EMPTY_SEARCH: "Hiện tại không có kết quả phù hợp.",
    EMPTY_SEARCH_HISTORY: "Hiện tại chưa có lịch sử tìm kiếm.",
    EMPTY_FRIENDS: "Hiện tại chưa có bạn bè.",
    EMPTY_FRIEND_REQUESTS: "Hiện tại không có lời mời kết bạn.",
    EMPTY_STORIES: "Hiện tại không có story.",
    EMPTY_JOURNAL: "Hiện tại chưa có nội dung nhật ký.",
    EMPTY_FOOD_CATALOG: "Hiện tại Food Catalog đang trống.",
    EMPTY_PLACES: "Hiện tại không tìm thấy địa điểm phù hợp.",
    EMPTY_PROFILE_POSTS: "Hiện tại người dùng chưa có bài viết.",
    REQUEST_FAILED: "Không thể xử lý yêu cầu lúc này."
  },
  en: {
    SUCCESS: "Success.",
    EMPTY_FEED: "There are currently no feed stories.",
    EMPTY_NOTIFICATIONS: "There are currently no notifications.",
    EMPTY_COMMENTS: "There are currently no comments.",
    EMPTY_REACTIONS: "There are currently no reactions.",
    EMPTY_SEARCH: "There are currently no matching results.",
    EMPTY_SEARCH_HISTORY: "There is currently no search history.",
    EMPTY_FRIENDS: "There are currently no friends.",
    EMPTY_FRIEND_REQUESTS: "There are currently no friend requests.",
    EMPTY_STORIES: "There are currently no stories.",
    EMPTY_JOURNAL: "There are currently no journal entries.",
    EMPTY_FOOD_CATALOG: "The Food Catalog is currently empty.",
    EMPTY_PLACES: "There are currently no matching places.",
    EMPTY_PROFILE_POSTS: "This user currently has no posts.",
    REQUEST_FAILED: "The request could not be processed right now."
  }
} as const;

type MessageCode = keyof typeof messages.vi;

export function localizeApiPayload(
  request: Pick<FastifyRequest, "headers">,
  status: number,
  payload: unknown,
  source: { functionName: string; functionPath?: string }
): unknown {
  if (!isJson(payload)) return payload;
  if (text(payload.messageCode) && text(payload.message) && text(payload.locale)) return payload;
  const locale = resolveLocale(request.headers["x-locale"] ?? request.headers["accept-language"]);
  const success = status >= 200 && status < 300;
  const messageCode = success ? emptyMessageCode(payload, source) ?? "SUCCESS" : "REQUEST_FAILED";
  const existingMessage = text(payload.message) || text(payload.error);
  return {
    ...payload,
    success: typeof payload.success === "boolean" ? payload.success : success,
    messageCode,
    message: success ? messages[locale][messageCode] : existingMessage || messages[locale].REQUEST_FAILED,
    locale
  };
}

export function localizeDirectPayload(
  request: Pick<FastifyRequest, "headers">,
  status: number,
  payload: unknown
) {
  return localizeApiPayload(request, status, payload, { functionName: "mcrservice" });
}

function emptyMessageCode(payload: Json, source: { functionName: string; functionPath?: string }): MessageCode | null {
  const path = source.functionPath ?? "";
  if (source.functionName === "home-feed") {
    if (!path && empty(payload.posts)) return "EMPTY_FEED";
    if (path === "comments" && empty(payload.comments)) return "EMPTY_COMMENTS";
    if (path === "reactions" && empty(payload.users)) return "EMPTY_REACTIONS";
  }
  if (source.functionName === "notifications" && empty(payload.notifications)) return "EMPTY_NOTIFICATIONS";
  if (source.functionName === "stories" && empty(payload.stories)) return "EMPTY_STORIES";
  if (source.functionName === "friends") {
    if (empty(payload.requests)) return "EMPTY_FRIEND_REQUESTS";
    if (empty(payload.friends)) return "EMPTY_FRIENDS";
  }
  if (source.functionName === "journal") {
    if (empty(payload.entries) || empty(payload.markers)) return "EMPTY_JOURNAL";
  }
  if (source.functionName === "food-catalog" && empty(payload.items)) return "EMPTY_FOOD_CATALOG";
  if (["goong-place-search", "vietmap-place-search"].includes(source.functionName) && empty(payload.places)) return "EMPTY_PLACES";
  if (source.functionName === "profile" && empty(payload.posts)) return "EMPTY_PROFILE_POSTS";
  if (source.functionName === "app-search") {
    if (path === "recent" && empty(payload.recent)) return "EMPTY_SEARCH_HISTORY";
    if (path === "posts" && empty(payload.posts)) return "EMPTY_SEARCH";
    if (!path && [payload.users, payload.places, payload.foods].every(empty)) return "EMPTY_SEARCH";
  }
  return null;
}

function resolveLocale(value: unknown): Locale {
  return text(value).toLowerCase().startsWith("en") ? "en" : "vi";
}
function empty(value: unknown): boolean { return Array.isArray(value) && value.length === 0; }
function isJson(value: unknown): value is Json { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
