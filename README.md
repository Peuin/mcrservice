Bộ skill Full-stack Peuin với TypeScript, Flutter và Supabase

Phần này mở rộng file hướng dẫn hiện tại để agent có thể làm việc nhất quán trên toàn bộ stack của **Project Peuin** gồm:

- Flutter mobile app
- TypeScript Backend (Modular Monolith) chạy trên Docker + K3s
- Deploy tự động qua Argo CD
- Supabase PostgreSQL (Database chính)
- Redis (chạy trong VPS/K8s để làm caching và queue)
- BullMQ (Background Worker xử lý tác vụ nền)

Nguyên tắc tổng quát: **Flutter ưu tiên gọi API Server cho nghiệp vụ chính**, TypeScript xử lý business logic và kiểm soát quyền truy cập, Supabase đóng vai trò Database. Flutter chỉ gọi Supabase trực tiếp ở các luồng được cho phép rõ ràng như auth session hoặc upload có signed URL.

---

## Cấu trúc backend TypeScript chuẩn cho Project Peuin

Khi task liên quan backend Node.js/TypeScript, agent **bắt buộc** bám theo root:

```text
BE/mcrservice/                      # = /Users/peuin/Desktop/Peuin_App/BE/mcrservice
```

Để tối ưu cho K3s và BullMQ, Peuin sử dụng kiến trúc **Modular Monolith**. Code API và Worker nằm chung một repo để share type/logic, nhưng được tách ra 2 entry points riêng biệt để deploy thành các Pods độc lập trên K8s.

Cấu trúc thư mục:

```text
BE/mcrservice/
├── .github/workflows/              # CI build Docker image
├── k8s/                            # Nơi Argo CD theo dõi để sync lên K3s
│   ├── base/                       # YAML gốc (Deployment, Service, Ingress, ConfigMap)
│   └── overlays/                   # Cấu hình riêng cho dev/prod
├── src/
│   ├── config/                     # Load env, config Supabase, Redis, BullMQ
│   ├── core/                       # Middleware, Interceptors, Exceptions, Logger
│   ├── db/                         # Cấu hình Prisma hoặc Drizzle ORM connect Supabase
│   ├── modules/                    # Chia theo Domain/Nghiệp vụ
│   │   ├── auth/                   # Auth, JWT verification
│   │   ├── profile/                # Hồ sơ người dùng, settings
│   │   ├── content/                # Bài viết, media metadata, comment, reaction
│   │   ├── feed/                   # Feed ranking, caching Redis
│   │   ├── notification/           # In-app notification, Push token
│   │   └── shared/                 # Code share giữa các modules (DTOs dùng chung)
│   ├── workers/                    # Cấu hình Consumer cho BullMQ
│   │   ├── processors/             # Logic xử lý job (thumbnail, cleanup, fanout)
│   │   └── worker.server.ts        # Entry point khởi chạy Worker (KHÔNG mở port HTTP)
│   └── api.server.ts               # Entry point khởi chạy API Server (Express/Fastify)
├── Dockerfile                      # Multi-stage build dùng chung cho cả API và Worker
├── docker-compose.yml              # Chạy Redis, Postgres local cho dev
├── package.json
├── tsconfig.json
└── README.md
```

### Quy tắc module backend (`BE/mcrservice/`)

- **API Server (`api.server.ts`)**: Chỉ nhận HTTP Request, thao tác Database và đẩy Job vào Queue (BullMQ Producer).
- **Worker Server (`worker.server.ts`)**: Khởi tạo BullMQ Consumer, lắng nghe Redis và thực thi tác vụ nền. Không expose HTTP port.
- Gateway/Ingress được cấu hình bằng NGINX Ingress hoặc Traefik trực tiếp trong manifest của K3s (`k8s/base/ingress.yaml`).
- Tách biệt rõ ràng Route (Controller) -> Service (Business Logic) -> Repository/DB (Data Access).
- Sử dụng **Zod** hoặc **class-validator** để validate request ngay tại middleware.

---

## Trách nhiệm từng Domain/Module trong Peuin Backend

### `auth` + `profile` module
- Verify JWT Token từ Supabase Auth gửi lên.
- Quản lý username, avatar, bio, follow, block.
- Đồng bộ thông tin từ Supabase Auth sang bảng profile nghiệp vụ qua webhook/API.

### `content` module (Post & Media)
- Tạo/sửa/xóa bài viết, comment, reaction.
- Quản lý upload session, sinh Signed URL để client upload trực tiếp lên bucket (Supabase Storage/S3).
- Lưu metadata file, đẩy job `PROCESS_MEDIA` vào BullMQ.

### `feed` module
- Xử lý Home feed, Profile feed.
- Đọc/ghi cache vào Redis.

### `workers` (BullMQ Consumers)
- Tác vụ nền: `generate-thumbnail`, `cleanup-expired-stories`, `feed-fanout`, `send-push-notification`.
- Lấy payload từ Redis, thực thi, cập nhật trạng thái vào Supabase PostgreSQL, và retry nếu có lỗi.

---

## Quy ước TypeScript API

### URL convention
Cấu trúc route theo RESTful:
```text
/api/v1/users/me
/api/v1/users/:userId/follow
/api/v1/posts/:postId/comments
/api/v1/media/upload-sessions
```

### Response chuẩn
Mọi API trả về JSON thống nhất:
```json
{
  "success": true,
  "message": "Success",
  "data": {}
}
```
Error response:
```json
{
  "success": false,
  "code": "POST_NOT_FOUND",
  "message": "Post not found",
  "requestId": "uuid-v4"
}
```

### HTTP Status Convention
- `200 OK`: Thành công.
- `201 Created`: Tạo mới thành công.
- `400 Bad Request`: Zod validation failed.
- `401 Unauthorized`: Thiếu hoặc sai Bearer token.
- `403 Forbidden`: Có token nhưng sai quyền (Resource ownership).
- `404 Not Found`: Không tìm thấy dữ liệu.

---

## Quy ước Database & ORM (Supabase PostgreSQL)

- **ORM:** Khuyến nghị dùng **Prisma** hoặc **Drizzle ORM** kết nối trực tiếp vào Postgres của Supabase. 
- Dùng port `6543` (Transaction pooler) của Supabase trong connection string nếu backend scale lên nhiều Pods để tránh cạn kiệt connection.
- Migration vẫn có thể quản lý tại `DB/supabase/migrations/` hoặc dùng trực tiếp CLI của Prisma/Drizzle tùy chiến lược, nhưng cần thống nhất 1 nguồn (Ưu tiên dùng `DB/supabase` để gom chung RLS rules).
- Cần tự handle Authorization ở tầng Service bằng cách filter theo `userId` lấy từ JWT, thay vì dựa hoàn toàn vào Supabase RLS (vì backend đang dùng Service Role key hoặc connection gộp).

---

## Quy ước Event/Worker với BullMQ & Redis

Khi API cần xử lý async, hệ thống dùng Redis và BullMQ.

### Khai báo Queue & Job
- Queue name đặt theo domain: `media-queue`, `notification-queue`, `feed-queue`.
- Payload job phải chuẩn hóa:
```typescript
interface ProcessMediaJobData {
  userId: string;
  mediaId: string;
  bucket: string;
  path: string;
  type: 'image' | 'video';
}
```

### Flow hoạt động
1. API gọi `await mediaQueue.add('generate-thumbnail', payload, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } })`.
2. Worker Deployment trên K3s nhận job, xử lý tạo thumbnail, cập nhật status vào PostgreSQL.
3. Worker phải thiết kế theo chuẩn **idempotent** (chạy lại 2 lần không gây lỗi duplicate dữ liệu).

---

## Quy ước Deploy: Docker + K3s + Argo CD

### Dockerfile
Chỉ dùng 1 `Dockerfile` (Multi-stage) để build ra 1 Image duy nhất (VD: `peuin-backend:v1.0.0`).
- Chạy API: `CMD ["node", "dist/api.server.js"]` (Overwritten ở file YAML K8s).
- Chạy Worker: `CMD ["node", "dist/worker.server.js"]` (Overwritten ở file YAML K8s).

### K8s Manifests (`BE/mcrservice/k8s/`)
Sẽ có các file YAML chính:
1. `api-deployment.yaml`: Replicas tùy tải, port 3000, command trỏ tới `api.server.js`.
2. `worker-deployment.yaml`: Replicas độc lập (có thể cấu hình HPA dựa trên độ dài BullMQ), command trỏ tới `worker.server.js`.
3. `redis-statefulset.yaml`: Dựng Redis nội bộ trong K3s (hoặc dùng Helm chart).
4. `ingress.yaml`: Map domain API về `api-service`.

### Argo CD Flow
1. Cập nhật code, CI Github Actions build Docker Image.
2. Push Image lên Registry.
3. CI update version tag trong file `k8s/overlays/prod/kustomization.yaml`.
4. Argo CD phát hiện thay đổi trên Git, tự động Sync (Rolling Update) các Pods trên K3s.

---

## Quy ước Môi trường (.env) cho 3 Source

Mỗi source có `.env.example` riêng. 

### `MB_APP/.env.example` (Flutter)
```env
APP_ENV=local
API_BASE_URL=https://api.peuin.com/v1
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

### `BE/mcrservice/.env.example` (TypeScript Backend)
```env
APP_ENV=local
PORT=3000

# Database
DATABASE_URL=postgres://postgres.[project-ref]:[password]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres

# Supabase Admin
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret

# Redis (Cho K3s hoặc VPS nội bộ)
REDIS_HOST=redis-master.default.svc.cluster.local
REDIS_PORT=6379
REDIS_PASSWORD=
```

---

## Prompt template cho Agent code TypeScript Feature

Khi tạo feature backend mới, dùng template sau:

```text
Implement backend feature for Project Peuin.

Context:
- Stack: TypeScript, Node.js, Express (or Fastify), BullMQ, Redis, Prisma/Drizzle ORM.
- Follow modular monolith structure in BE/mcrservice/src/modules/[module-name].
- Do not expose DB entities directly. Map to Response DTOs.
- Use Zod for request validation.
- Auth user comes from Supabase JWT verified in middleware (req.user.id).

Feature:
- Name: [feature-name]
- Business goal: [goal]
- Endpoint(s): [endpoint list]
- DB tables: [tables]
- Async Jobs: [Queue name & Job logic]

Requirements:
1. Create/update API contract in docs/api-contract/[feature].md.
2. Define Zod schemas for Request/Response.
3. Implement Controller (handling HTTP) and Service (business logic).
4. Implement Worker Processor if background task is needed.
5. Provide Prisma/Drizzle schema updates if DB changes.
6. Add unit tests (Vitest/Jest) for business logic.
7. Provide curl command to test.
```