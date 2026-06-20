# Feed API contract

All public endpoints require `Authorization: Bearer <Supabase access token>` when the operation is user-specific.

| Method | Endpoint | Responsibility |
| --- | --- | --- |
| GET | `/api/v1/feed` | Paginated home feed list (`limit`, `cursorCreatedAt`, `feedSeed`, `refresh`) |
| POST | `/api/v1/posts` | Create one post; author comes from JWT |
| GET | `/api/v1/posts/:postId` | Get one visible post |
| GET | `/api/v1/posts/:postId/comments` | Get the comment thread |
| POST | `/api/v1/posts/:postId/comments` | Create a top-level comment |
| POST | `/api/v1/posts/:postId/comments/:commentId/replies` | Reply to one comment |
| POST | `/api/v1/posts/:postId/reactions/love` | Toggle the current user's post love |
| GET | `/api/v1/posts/:postId/reactions` | List users reacting to one post |
| POST | `/api/v1/comments/:commentId/reactions/love` | Toggle the current user's comment love |
| GET | `/api/v1/comments/:commentId/reactions` | List users reacting to one comment |
| POST | `/internal/workers/feed-cache/warm` | Internal cache warming; requires server-side warm secret |

The existing `/home-feed/*` routes remain temporary compatibility aliases. New clients should use `/api/v1/*`.

Cache is not a client-owned resource. Public clients can request `refresh`, but only the internal worker may warm cache proactively.
