# Friends API contract

The module exposes separate resources for friend lists, requests, friendships, and blocks under `/api/v1/gov-data/*`. Every mutation acts as the authenticated Supabase user; actor IDs are never accepted from request bodies.

Supported operations include list friends, list incoming/outgoing requests, inspect relationship status, send/respond/cancel requests, remove friendships, and block/unblock users.

The existing GET/POST `/friends` and `/user/friends` routes remain hidden compatibility aliases.
