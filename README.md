# Peuin Kubernetes Spring Boot Services

Spring Boot services generated from the Supabase Edge Functions in `../functions`.

## Function Mapping

| Edge Function | Spring Boot service | Endpoint |
| --- | --- | --- |
| `auth-password-reset` | `auth-service` | `POST /auth-password-reset`, `POST /auth/password-reset` |
| `auth-verify-password-reset-otp` | `auth-service` | `POST /auth-verify-password-reset-otp`, `POST /auth/password-reset/verify` |
| `auth-complete-password-reset` | `auth-service` | `POST /auth-complete-password-reset`, `POST /auth/password-reset/complete` |
| `profile` | `user-service` | `GET/POST /profile`, `/user/profile` |
| `friends` | `user-service` | `GET/POST /friends`, `/user/friends` |
| `personality` | `user-service` | `POST /personality`, `/user/personality` |
| `ask-peuin` | `user-service` | `POST /ask-peuin`, `/user/ask-peuin` |
| `home-feed` | `feed-service` | `GET/POST /home-feed/*`, `/feed/home-feed/*` |
| `journal` | `feed-service` | `GET /journal`, `/feed/journal` |
| `stories` | `feed-service` | `GET /stories`, `/feed/stories` |
| `food-catalog` | `feed-service` | `GET /food-catalog`, `/feed/food-catalog` |
| `app-search` | `search-service` | `GET /app-search`, `/search/app-search` |
| `goong-place-search` | `search-service` | `GET /goong-place-search`, `/search/goong-place-search` |
| `vietmap-place-search` | `search-service` | `GET /vietmap-place-search`, `/search/vietmap-place-search` |
| `home-feed-warm` | `worker-service` | `POST /home-feed-warm`, `/worker/home-feed-warm` |
| `app-search-warm` | `worker-service` | `POST /app-search-warm`, `/worker/app-search-warm` |

## Local Build

Requires JDK 21 and Maven 3.9+.

```bash
mvn -DskipTests package
```

Run one service:

```bash
cd apps/auth-service
PORT=8081 SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... mvn spring-boot:run
```

## Kubernetes

1. Copy `infra/secrets/peuin-secrets.example.yaml` to a non-committed secret file and fill real values.
2. Apply namespace/config/secret/deployments:

```bash
kubectl apply -f infra/namespace/namespace.yaml
kubectl apply -f infra/configmaps/peuin-config.yaml
kubectl apply -f infra/secrets/peuin-secrets.yaml
kubectl apply -f infra/k8s-services.yaml
```

## Porting Status

`auth-service` ports the OTP/password reset flow directly. The other services are scaffolded with Spring Boot endpoints and Supabase REST/RPC calls that match the current Edge Function contracts; large Deno-only logic such as Gemini prompt orchestration, rich feed object shaping, place normalization, Bunny upload handling, and Upstash cache writes should be ported incrementally from the corresponding `BE/functions/*/index.ts` files.
