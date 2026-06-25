#!/usr/bin/env node
/**
 * Generates mcrservice.postman_collection.json from route definitions.
 * Run: node postman/generate-collection.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "{{baseUrl}}";

const saveTokenScript = [
  "const json = pm.response.json();",
  "const token = json.session?.access_token || json.access_token;",
  "if (token) {",
  "  pm.environment.set('accessToken', token);",
  "  pm.collectionVariables.set('accessToken', token);",
  "}",
  "if (json.user?.id) pm.environment.set('userId', json.user.id);"
];

function buildUrl(path, query = {}) {
  const pathParts = path.replace(/^\//, "").split("/");
  const entries = Object.entries(query);
  const queryStr = entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return {
    raw: `${BASE}${path}${queryStr ? `?${queryStr}` : ""}`,
    host: [BASE],
    path: pathParts,
    ...(entries.length
      ? { query: entries.map(([key, value]) => ({ key, value: String(value) })) }
      : {})
  };
}

function jsonBody(value) {
  return {
    mode: "raw",
    raw: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    options: { raw: { language: "json" } }
  };
}

function req(name, { method, path, query, body, auth = true, description, testScript, extraHeaders = [] }) {
  const headers = [...extraHeaders];
  if (body) headers.push({ key: "Content-Type", value: "application/json" });
  if (auth) headers.push({ key: "Authorization", value: "Bearer {{accessToken}}" });

  const item = {
    name,
    ...(description ? { description } : {}),
    request: {
      method,
      header: headers,
      url: buildUrl(path, query),
      ...(body ? { body: jsonBody(body) } : {})
    }
  };

  if (testScript) {
    item.event = [{ listen: "test", script: { type: "text/javascript", exec: testScript } }];
  }
  return item;
}

function folder(name, items, description) {
  return { name, ...(description ? { description } : {}), item: items };
}

const collection = {
  info: {
    name: "MCR Service - Local",
    description:
      "Tất cả endpoint mcrservice cho test local (http://localhost:8080). Chạy Login trước để lưu accessToken.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  auth: {
    type: "bearer",
    bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }]
  },
  variable: [
    { key: "baseUrl", value: "http://localhost:8080" },
    { key: "accessToken", value: "" },
    { key: "userId", value: "00000000-0000-0000-0000-000000000001" },
    { key: "postId", value: "00000000-0000-0000-0000-000000000002" },
    { key: "commentId", value: "00000000-0000-0000-0000-000000000003" },
    { key: "notificationId", value: "00000000-0000-0000-0000-000000000004" },
    { key: "requestId", value: "00000000-0000-0000-0000-000000000005" },
    { key: "foodCatalogId", value: "00000000-0000-0000-0000-000000000006" },
    { key: "recentSearchId", value: "00000000-0000-0000-0000-000000000007" }
  ],
  item: [
    folder("Health", [
      req("GET /health", { method: "GET", path: "/health", auth: false })
    ]),
    folder("Auth", [
      req("POST /auth/v1/user (Login)", {
        method: "POST",
        path: "/auth/v1/user",
        auth: false,
        body: { email: "user@example.com", password: "your-password" },
        description: "Đăng nhập — tự lưu accessToken vào environment.",
        testScript: saveTokenScript
      }),
      req("POST /auth/signup", {
        method: "POST",
        path: "/auth/signup",
        auth: false,
        body: { email: "newuser@example.com", password: "password123" }
      }),
      req("POST /auth/v1/signup (legacy)", {
        method: "POST",
        path: "/auth/v1/signup",
        auth: false,
        body: { email: "newuser@example.com", password: "password123" }
      }),
      req("POST /auth/password-reset", {
        method: "POST",
        path: "/auth/password-reset",
        auth: false,
        body: { emailOrUsername: "user@example.com", locale: "vi" }
      }),
      req("POST /auth/password-reset/verify", {
        method: "POST",
        path: "/auth/password-reset/verify",
        auth: false,
        body: { emailOrUsername: "user@example.com", otpCode: "123456", locale: "vi" }
      }),
      req("POST /auth/password-reset/complete", {
        method: "POST",
        path: "/auth/password-reset/complete",
        auth: false,
        body: {
          emailOrUsername: "user@example.com",
          otpCode: "123456",
          newPassword: "newpassword123",
          locale: "vi"
        }
      })
    ]),
    folder("Profile", [
      req("GET /api/v1/profiles/me", { method: "GET", path: "/api/v1/profiles/me" }),
      req("GET /api/v1/profiles/me?username", {
        method: "GET",
        path: "/api/v1/profiles/me",
        query: { username: "peuin_user" }
      }),
      req("GET /api/v1/profiles/:userId", {
        method: "GET",
        path: "/api/v1/profiles/{{userId}}"
      }),
      req("PATCH /api/v1/profiles/me", {
        method: "PATCH",
        path: "/api/v1/profiles/me",
        body: {
          displayName: "Peuin User",
          username: "peuin_user",
          bio: "Hello from Postman",
          isPrivate: false
        }
      })
    ]),
    folder("Feed & Posts", [
      req("GET /api/v1/feed", {
        method: "GET",
        path: "/api/v1/feed",
        query: { limit: "20" }
      }),
      req("POST /api/v1/posts", {
        method: "POST",
        path: "/api/v1/posts",
        body: {
          caption: "Test post from Postman",
          mediaPath: "posts/test/media.jpg",
          visibility: "public"
        }
      }),
      req("GET /api/v1/posts/:postId", { method: "GET", path: "/api/v1/posts/{{postId}}" }),
      req("GET /api/v1/posts/:postId/comments", {
        method: "GET",
        path: "/api/v1/posts/{{postId}}/comments"
      }),
      req("POST /api/v1/posts/:postId/comments", {
        method: "POST",
        path: "/api/v1/posts/{{postId}}/comments",
        body: { body: "Nice post!" }
      }),
      req("POST /api/v1/posts/:postId/comments/:commentId/replies", {
        method: "POST",
        path: "/api/v1/posts/{{postId}}/comments/{{commentId}}/replies",
        body: { body: "Thanks!" }
      }),
      req("POST /api/v1/posts/:postId/reactions/love", {
        method: "POST",
        path: "/api/v1/posts/{{postId}}/reactions/love",
        body: { currentlyLiked: false }
      }),
      req("GET /api/v1/posts/:postId/reactions", {
        method: "GET",
        path: "/api/v1/posts/{{postId}}/reactions"
      }),
      req("POST /api/v1/comments/:commentId/reactions/love", {
        method: "POST",
        path: "/api/v1/comments/{{commentId}}/reactions/love",
        body: { currentlyLiked: false }
      }),
      req("GET /api/v1/comments/:commentId/reactions", {
        method: "GET",
        path: "/api/v1/comments/{{commentId}}/reactions"
      })
    ]),
    folder("Journal", [
      req("GET /api/v1/journal/month-markers", {
        method: "GET",
        path: "/api/v1/journal/month-markers",
        query: { year: "2026", month: "6", timezone: "Asia/Ho_Chi_Minh" }
      }),
      req("GET /api/v1/journal/day-entries", {
        method: "GET",
        path: "/api/v1/journal/day-entries",
        query: { day: "2026-06-21", timezone: "Asia/Ho_Chi_Minh" }
      })
    ]),
    folder("Stories", [
      req("GET /api/v1/stories", {
        method: "GET",
        path: "/api/v1/stories",
        query: { limit: "40" }
      }),
      req("GET /api/v1/stories/archive", { method: "GET", path: "/api/v1/stories/archive" }),
      req("POST /api/v1/stories", {
        method: "POST",
        path: "/api/v1/stories",
        body: {
          mediaBase64: "iVBORw0KGgo=",
          contentType: "image/jpeg",
          caption: "Test story"
        },
        description: "mediaBase64 phải là ảnh thật (base64)."
      })
    ]),
    folder("Search", [
      req("GET /api/v1/search", {
        method: "GET",
        path: "/api/v1/search",
        query: { q: "pho", limit: "8" }
      }),
      req("GET /api/v1/search/posts", {
        method: "GET",
        path: "/api/v1/search/posts",
        query: { food: "pho", limit: "20" }
      }),
      req("GET /api/v1/search/recent", {
        method: "GET",
        path: "/api/v1/search/recent",
        query: { limit: "50" }
      }),
      req("POST /api/v1/search/recent", {
        method: "POST",
        path: "/api/v1/search/recent",
        body: {
          searchType: "food",
          query: "pho",
          targetId: "pho-bo",
          title: "Phở bò"
        }
      }),
      req("DELETE /api/v1/search/recent/:id", {
        method: "DELETE",
        path: "/api/v1/search/recent/{{recentSearchId}}"
      }),
      req("DELETE /api/v1/search/recent (clear all)", {
        method: "DELETE",
        path: "/api/v1/search/recent"
      })
    ]),
    folder("Notifications", [
      req("GET /api/v1/notifications", {
        method: "GET",
        path: "/api/v1/notifications",
        query: { limit: "30" }
      }),
      req("PATCH /api/v1/notifications/:id/read", {
        method: "PATCH",
        path: "/api/v1/notifications/{{notificationId}}/read"
      }),
      req("PATCH /api/v1/notifications/read-all", {
        method: "PATCH",
        path: "/api/v1/notifications/read-all"
      }),
      req("PATCH /api/v1/notifications/:id/mute", {
        method: "PATCH",
        path: "/api/v1/notifications/{{notificationId}}/mute"
      }),
      req("DELETE /api/v1/notifications/:id", {
        method: "DELETE",
        path: "/api/v1/notifications/{{notificationId}}"
      }),
      req("POST /api/v1/notification-devices/push-tokens", {
        method: "POST",
        path: "/api/v1/notification-devices/push-tokens",
        body: { token: "fcm-device-token", platform: "android" }
      }),
      req("DELETE /api/v1/notification-devices/push-tokens", {
        method: "DELETE",
        path: "/api/v1/notification-devices/push-tokens",
        body: { token: "fcm-device-token" }
      })
    ]),
    folder("Gov Data - Friends", [
      req("GET /api/v1/gov-data/friends", {
        method: "GET",
        path: "/api/v1/gov-data/friends",
        query: { limit: "50" }
      }),
      req("GET /api/v1/gov-data/friend-requests", {
        method: "GET",
        path: "/api/v1/gov-data/friend-requests",
        query: { direction: "incoming" }
      }),
      req("GET /api/v1/gov-data/friendships/:userId/status", {
        method: "GET",
        path: "/api/v1/gov-data/friendships/{{userId}}/status"
      }),
      req("POST /api/v1/gov-data/users/:userId/friend-requests", {
        method: "POST",
        path: "/api/v1/gov-data/users/{{userId}}/friend-requests"
      }),
      req("PATCH /api/v1/gov-data/friend-requests/:requestId", {
        method: "PATCH",
        path: "/api/v1/gov-data/friend-requests/{{requestId}}",
        body: { accept: true }
      }),
      req("DELETE /api/v1/gov-data/friend-requests/:requestId", {
        method: "DELETE",
        path: "/api/v1/gov-data/friend-requests/{{requestId}}"
      }),
      req("DELETE /api/v1/gov-data/friendships/:userId", {
        method: "DELETE",
        path: "/api/v1/gov-data/friendships/{{userId}}"
      }),
      req("POST /api/v1/gov-data/blocks/:userId", {
        method: "POST",
        path: "/api/v1/gov-data/blocks/{{userId}}"
      }),
      req("DELETE /api/v1/gov-data/blocks/:userId", {
        method: "DELETE",
        path: "/api/v1/gov-data/blocks/{{userId}}"
      })
    ]),
    folder("Gov Data - Food Catalog", [
      req("GET /api/v1/gov-data/food-catalog", {
        method: "GET",
        path: "/api/v1/gov-data/food-catalog"
      }),
      req("POST /api/v1/gov-data/food-catalog", {
        method: "POST",
        path: "/api/v1/gov-data/food-catalog",
        body: { nameVi: "Phở bò", nameEn: "Beef pho", slug: "pho-bo" }
      }),
      req("PATCH /api/v1/gov-data/food-catalog/:id/mark", {
        method: "PATCH",
        path: "/api/v1/gov-data/food-catalog/{{foodCatalogId}}/mark",
        body: { isMarked: true }
      })
    ]),
    folder("AI Ask Peuin", [
      req("POST /api/v1/ai/ask", {
        method: "POST",
        path: "/api/v1/ai/ask",
        body: {
          query: "Ăn gì hôm nay?",
          meal_filters: { meal_period: "lunch", taste: "any" }
        }
      }),
      req("GET /api/v1/ai/sessions/today", {
        method: "GET",
        path: "/api/v1/ai/sessions/today"
      }),
      req("POST /api/v1/ai/recommendations/feedback", {
        method: "POST",
        path: "/api/v1/ai/recommendations/feedback",
        body: {
          recommendation_id: "00000000-0000-0000-0000-000000000099",
          feedback: "like"
        }
      }),
      req("POST /api/v1/ai/personality/reply", {
        method: "POST",
        path: "/api/v1/ai/personality/reply",
        body: { query: "Xin chào Peuin!" }
      }),
      req("GET /api/v1/ai/personality/health", {
        method: "GET",
        path: "/api/v1/ai/personality/health"
      }),
      req("POST /ask-peuin (legacy)", {
        method: "POST",
        path: "/ask-peuin",
        body: { query: "Ăn gì hôm nay?" }
      }),
      req("POST /user/ask-peuin (legacy)", {
        method: "POST",
        path: "/user/ask-peuin",
        body: { query: "Ăn gì hôm nay?" }
      }),
      req("POST /personality (legacy)", {
        method: "POST",
        path: "/personality",
        body: { query: "Xin chào!" }
      }),
      req("POST /user/personality (legacy)", {
        method: "POST",
        path: "/user/personality",
        body: { query: "Xin chào!" }
      })
    ]),
    folder("Map", [
      req("GET /api/v1/map/places/goong", {
        method: "GET",
        path: "/api/v1/map/places/goong",
        query: { query: "VNG", limit: "12", local_only: "false" }
      }),
      req("GET /api/v1/map/places/goong (nearby)", {
        method: "GET",
        path: "/api/v1/map/places/goong",
        query: { near_lat: "10.7769", near_lng: "106.7009", limit: "12", local_only: "false" }
      }),
      req("GET /api/v1/map/places/vietmap (alias)", {
        method: "GET",
        path: "/api/v1/map/places/vietmap",
        query: { query: "VNG", limit: "12" }
      }),
      req("GET /goong-place-search (legacy)", {
        method: "GET",
        path: "/goong-place-search",
        query: { query: "VNG", limit: "12" }
      }),
      req("POST /goong-place-search (legacy)", {
        method: "POST",
        path: "/goong-place-search",
        body: { query: "VNG", limit: 12, local_only: false }
      }),
      req("GET /search/goong-place-search (legacy)", {
        method: "GET",
        path: "/search/goong-place-search",
        query: { query: "VNG", limit: "12" }
      }),
      req("GET /vietmap-place-search (legacy)", {
        method: "GET",
        path: "/vietmap-place-search",
        query: { query: "VNG", limit: "12" }
      }),
      req("GET /search/vietmap-place-search (legacy)", {
        method: "GET",
        path: "/search/vietmap-place-search",
        query: { query: "VNG", limit: "12" }
      })
    ]),
    folder("Feedback", [
      req("POST /api/v1/feedback", {
        method: "POST",
        path: "/api/v1/feedback",
        body: { body: "Góp ý từ Postman" }
      }),
      req("POST /app-feedback (legacy)", {
        method: "POST",
        path: "/app-feedback",
        body: { body: "Góp ý từ Postman" }
      })
    ]),
    folder("Workers (internal)", [
      req("POST /internal/workers/feed-cache/warm", {
        method: "POST",
        path: "/internal/workers/feed-cache/warm",
        body: {},
        description: "Cần HOME_FEED_WARM_SECRET trong .env"
      }),
      req("POST /home-feed-warm (legacy)", {
        method: "POST",
        path: "/home-feed-warm",
        body: {}
      }),
      req("POST /worker/home-feed-warm (legacy)", {
        method: "POST",
        path: "/worker/home-feed-warm",
        body: {}
      }),
      req("POST /internal/workers/search-cache/warm", {
        method: "POST",
        path: "/internal/workers/search-cache/warm",
        body: {},
        description: "Cần APP_SEARCH_WARM_SECRET trong .env"
      }),
      req("POST /app-search-warm (legacy)", {
        method: "POST",
        path: "/app-search-warm",
        body: {}
      }),
      req("POST /worker/app-search-warm (legacy)", {
        method: "POST",
        path: "/worker/app-search-warm",
        body: {}
      }),
      req("POST /internal/workers/notification-push", {
        method: "POST",
        path: "/internal/workers/notification-push",
        body: {},
        extraHeaders: [{ key: "x-push-secret", value: "{{pushSecret}}" }],
        description: "Cần NOTIFICATION_PUSH_SECRET trong .env"
      }),
      req("POST /notification-push (legacy)", {
        method: "POST",
        path: "/notification-push",
        body: {},
        extraHeaders: [{ key: "x-push-secret", value: "{{pushSecret}}" }]
      })
    ], "Worker endpoints — cần secret tương ứng trong .env local.")
  ]
};

const outPath = join(__dirname, "mcrservice.postman_collection.json");
writeFileSync(outPath, `${JSON.stringify(collection, null, 2)}\n`);
const total = collection.item.reduce((n, f) => n + f.item.length, 0);
console.log(`Wrote ${outPath} (${total} requests in ${collection.item.length} folders)`);
