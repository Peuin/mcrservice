# Map place-search API contract

| Method | Endpoint | Provider |
| --- | --- | --- |
| GET | `/api/v1/map/places/goong` | Goong with local database fallback/cache |

Both endpoints accept `query`, `limit`, optional `nearLat` + `nearLng`, and `localOnly`. A text query or a complete coordinate pair is required. Provider API keys remain server-side.

Goong is the only runtime provider for place search, nearby search, reverse geocoding, and map tiles. Legacy VietMap URLs remain hidden compatibility aliases, but they are routed to `goong-place-search` and never call VietMap.
