# Journal API contract

| Method | Endpoint | Responsibility |
| --- | --- | --- |
| GET | `/api/v1/journal/month-markers` | Return journal markers for one calendar month |
| GET | `/api/v1/journal/day-entries` | Return journal entries for one local calendar day |

Both endpoints accept an optional IANA `timezone`, defaulting to `Asia/Ho_Chi_Minh`, and forward the authenticated Supabase JWT so database RLS remains authoritative.

The existing GET/POST `/journal` route remains a hidden compatibility alias.
