# Search API contract

| Method | Endpoint | Responsibility |
| --- | --- | --- |
| GET | `/api/v1/search` | Discover users, places and foods |
| GET | `/api/v1/search/posts` | Find posts by exactly one of `placeId` or `food` |
| GET | `/api/v1/search/recent` | List the current user's search history |
| POST | `/api/v1/search/recent` | Upsert one search-history item |
| DELETE | `/api/v1/search/recent/:id` | Delete one owned history item |
| DELETE | `/api/v1/search/recent` | Clear the current user's search history |
| POST | `/internal/workers/search-cache/warm` | Warm search and vector caches using a server-side secret |

The current `/app-search/*` paths remain hidden compatibility aliases for Flutter. New clients should use `/api/v1/search/*`.
