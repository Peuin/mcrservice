# Profile API contract

| Method | Endpoint | Responsibility |
| --- | --- | --- |
| GET | `/api/v1/profiles/me` | Current profile, or lookup with optional `username` |
| GET | `/api/v1/profiles/:userId` | Profile wall by user ID |
| PATCH | `/api/v1/profiles/me` | Update the authenticated user's profile |

The profile owner always comes from the verified Supabase JWT for updates. The request body cannot select another user.

The existing `/profile` and `/user/profile` routes remain hidden compatibility aliases for Flutter.
