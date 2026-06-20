# Stories API contract

| Method | Endpoint | Responsibility |
| --- | --- | --- |
| GET | `/api/v1/stories` | List currently visible stories, limited to 1-80 |
| GET | `/api/v1/stories/archive` | List all stories owned by the authenticated user |
| POST | `/api/v1/stories` | Upload one base64 image to Bunny Storage and create a 24-hour story |

Story creation accepts JPEG, PNG, WebP, or HEIC and has a dedicated 21 MiB HTTP body limit for base64 payloads. Ownership is always derived from the Supabase JWT.

The existing GET/POST `/stories` route remains a hidden compatibility alias.
