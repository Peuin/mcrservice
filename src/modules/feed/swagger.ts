const uuid = { type: "string", format: "uuid" } as const;
const errorResponse = { type: "object", additionalProperties: true } as const;
const jsonResponse = { type: "object", additionalProperties: true } as const;
const bearerSecurity = [{ bearerAuth: [] }] as const;

const postIdParams = { type: "object", required: ["postId"], properties: { postId: uuid } } as const;
const commentIdParams = { type: "object", required: ["commentId"], properties: { commentId: uuid } } as const;
const commentBody = {
  type: "object", required: ["body"], additionalProperties: false,
  properties: { body: { type: "string", minLength: 1, maxLength: 2000 } }
} as const;
const loveBody = {
  type: "object", required: ["currentlyLiked"], additionalProperties: false,
  properties: { currentlyLiked: { type: "boolean" } }
} as const;

function docs(summary: string) {
  return { tags: ["Feed"], summary, security: bearerSecurity, response: { 200: jsonResponse, 400: errorResponse, 401: errorResponse } } as const;
}

export const listFeedDocs = {
  ...docs("Danh sách home feed"),
  querystring: { type: "object", additionalProperties: false, properties: {
    limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    cursorCreatedAt: { type: "string", format: "date-time" },
    feedSeed: { type: "string", minLength: 1, maxLength: 128 },
    refresh: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] }
  }}
} as const;
export const createPostDocs = {
  ...docs("Tạo bài viết"),
  body: { type: "object", additionalProperties: false, required: ["caption", "mediaPath"], properties: {
    caption: { type: "string", maxLength: 5000 }, visibility: { type: "string", enum: ["public", "followers", "private"] },
    mediaPath: { type: "string", minLength: 1, maxLength: 2048 }, placeId: uuid, placeName: { type: "string", maxLength: 500 },
    priceLabel: { type: "string", maxLength: 100 }, foodLabel: { type: "string", maxLength: 200 }, frameId: uuid,
    frameLabel: { type: "string", maxLength: 200 }, plainLayout: { type: "boolean" }, promptMode: { type: "string", maxLength: 100 },
    prompt: { type: "string", maxLength: 1000 }, tags: { type: "array", maxItems: 30, items: { type: "string" } },
    mentions: { type: "array", maxItems: 50, items: { type: "string" } }, topics: { type: "array", maxItems: 20, items: { type: "string" } }
  }},
  response: { 201: jsonResponse, 400: errorResponse, 401: errorResponse }
} as const;
export const getPostDocs = { ...docs("Chi tiết bài viết"), params: postIdParams } as const;
export const listCommentsDocs = { ...docs("Danh sách bình luận"), params: postIdParams } as const;
export const createCommentDocs = { ...docs("Tạo bình luận"), params: postIdParams, body: commentBody } as const;
export const createReplyDocs = { ...docs("Trả lời bình luận"), params: { type: "object", required: ["postId", "commentId"], properties: { postId: uuid, commentId: uuid } }, body: commentBody } as const;
export const togglePostLoveDocs = { ...docs("Thả hoặc bỏ love bài viết"), params: postIdParams, body: loveBody } as const;
export const listPostReactionsDocs = { ...docs("Danh sách reaction bài viết"), params: postIdParams } as const;
export const toggleCommentLoveDocs = { ...docs("Thả hoặc bỏ love bình luận"), params: commentIdParams, body: loveBody } as const;
export const listCommentReactionsDocs = { ...docs("Danh sách reaction bình luận"), params: commentIdParams } as const;
