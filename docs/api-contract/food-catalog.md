# Food Catalog API contract

| Method | Endpoint | Responsibility |
| --- | --- | --- |
| GET | `/api/v1/gov-data/food-catalog` | List active shared and user-owned catalog items with the current user's marks |
| POST | `/api/v1/gov-data/food-catalog` | Create one user-owned catalog item and mark it automatically |
| PATCH | `/api/v1/gov-data/food-catalog/:foodCatalogId/mark` | Set the current user's mark state |

The item owner and mark owner always come from the authenticated Supabase JWT. The existing GET/POST `/food-catalog` route remains a hidden compatibility alias.
