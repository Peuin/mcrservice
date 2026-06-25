# Map place-search API contract

| Method | Endpoint | Provider |
| --- | --- | --- |
| GET | `/api/v1/map/places/goong` | Goong Place API + local `core.places` fallback/cache |

Both endpoints accept `query`, `limit`, optional `nearLat` + `nearLng`, and `localOnly`. A text query or a complete coordinate pair is required.

Goong is the only runtime provider for place search, nearby search, and reverse geocoding. Legacy `/vietmap-place-search` URLs remain hidden compatibility aliases routed to the same Goong handler.

## Env vars

| Variable | Purpose |
| --- | --- |
| `GOONG_PLACE_API_KEY` / `GOONG_API_KEY` | Goong Place API |
| `SUPABASE_SERVICE_ROLE_KEY` (hoặc `SUPABASE_ANON_KEY` fallback) | Đọc/ghi `core.places` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Cache (optional) |
