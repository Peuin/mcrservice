# Deploy worker-service with Argo CD

Hướng dẫn deploy `worker-service` lên K3s bằng Argo CD. Image được build và push từ local hoặc CI; VPS chỉ pull image và sync manifest từ Git.

## A. Build và push image

Từ root project `mcrservice`:

```bash
docker build -t ghcr.io/nquynh2011199/worker-service:0.1.0 -f apps/worker-service/Dockerfile .
docker push ghcr.io/nquynh2011199/worker-service:0.1.0
```

Đăng nhập GHCR trước khi push (nếu chưa):

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u nquynh2011199 --password-stdin
```

## B. Tạo secret thật trên Kubernetes

Không commit secret thật lên Git. Tạo secret trực tiếp trên cluster:

```bash
kubectl create secret generic worker-service-secret \
  -n mcrservice \
  --from-literal=SUPABASE_URL="your_supabase_url" \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY="your_service_role_key" \
  --from-literal=OTP_HASH_SECRET="your_otp_hash_secret"
```

Nếu namespace `mcrservice` chưa tồn tại, tạo trước (bước C) hoặc dùng `--dry-run=client -o yaml | kubectl apply -f -` sau khi namespace đã có.

Tham khảo mẫu key tại `apps/worker-service/k8s/secret.example.yaml`.

## C. Apply namespace

```bash
kubectl apply -f infra/namespace/mcrservice-namespace.yaml
```

## D. Apply Argo CD Application

```bash
kubectl apply -f argocd/worker-service-app.yaml
```

Argo CD sẽ tự sync manifest từ path `apps/worker-service/k8s` trên branch `main`.

## E. Kiểm tra

```bash
kubectl get applications -n argocd
kubectl get pods -n mcrservice
kubectl get svc -n mcrservice
kubectl logs -f deployment/worker-service -n mcrservice
```

Trong Argo CD UI, application `worker-service` nên ở trạng thái `Synced` / `Healthy`.

## F. Test bằng port-forward

```bash
kubectl port-forward svc/worker-service 8081:8080 -n mcrservice
curl http://localhost:8081
```

## G. Image GHCR private — ImagePullBackOff

Nếu pod báo `ImagePullBackOff`, tạo image pull secret:

```bash
kubectl create secret docker-registry ghcr-secret \
  --namespace mcrservice \
  --docker-server=ghcr.io \
  --docker-username=nquynh2011199 \
  --docker-password="<GITHUB_TOKEN>" \
  --docker-email=nquynh2011199@gmail.com
```

Sau đó thêm vào `apps/worker-service/k8s/deployment.yaml` trong `spec.template.spec`:

```yaml
imagePullSecrets:
  - name: ghcr-secret
```

Commit, push lên Git; Argo CD sẽ tự sync lại.

## Cấu trúc manifest

| File | Mục đích |
|------|----------|
| `apps/worker-service/k8s/configmap.yaml` | Biến môi trường không nhạy cảm |
| `apps/worker-service/k8s/deployment.yaml` | Deployment, probes, resources |
| `apps/worker-service/k8s/service.yaml` | ClusterIP service port 8080 |
| `apps/worker-service/k8s/kustomization.yaml` | Kustomize bundle cho Argo CD |
| `apps/worker-service/k8s/secret.example.yaml` | Mẫu secret (không được apply) |
| `infra/namespace/mcrservice-namespace.yaml` | Namespace `mcrservice` |
| `argocd/worker-service-app.yaml` | Argo CD Application |

## Lệnh nhanh trên VPS

```bash
# 1. Clone hoặc pull repo (nếu cần apply thủ công)
git pull

# 2. Namespace
kubectl apply -f infra/namespace/mcrservice-namespace.yaml

# 3. Secret (chỉ lần đầu hoặc khi đổi credential)
kubectl create secret generic worker-service-secret \
  -n mcrservice \
  --from-literal=SUPABASE_URL="..." \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY="..." \
  --from-literal=OTP_HASH_SECRET="..." \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. Argo CD app
kubectl apply -f argocd/worker-service-app.yaml

# 5. Theo dõi
kubectl get applications -n argocd
kubectl get pods -n mcrservice -w
```

## H. Fix HTTPS cho `k3s.peuinjournal.com` (NET::ERR_CERT_AUTHORITY_INVALID)

Lỗi này xảy ra khi Argo CD / Traefik dùng **chứng chỉ self-signed**. Domain bật **HSTS** nên trình duyệt không cho bypass.

### Truy cập tạm (không cần domain)

Trên VPS:

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443 --address 0.0.0.0
```

Trên Mac:

```bash
ssh -p 2011 -L 8080:localhost:8080 peuin@103.116.38.132
```

Mở **https://localhost:8080** (chấp nhận cert self-signed trên localhost).

### Fix lâu dài — Let's Encrypt

**1. Kiểm tra DNS trỏ đúng VPS:**

```bash
dig +short k3s.peuinjournal.com
# Phải ra: 103.116.38.132
```

**2. Cài cert-manager (một lần):**

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.5/cert-manager.yaml
kubectl wait --for=condition=Available deployment/cert-manager -n cert-manager --timeout=120s
```

**3. Apply ClusterIssuer:**

```bash
kubectl apply -f infra/cert-manager/letsencrypt-prod.yaml
kubectl get clusterissuer letsencrypt-prod
```

**4. Cấu hình Argo CD terminate TLS tại Traefik (port 80 nội bộ):**

```bash
kubectl patch configmap argocd-cmd-params-cm -n argocd --type merge \
  -p '{"data":{"server.insecure":"true"}}'

kubectl patch configmap argocd-cm -n argocd --type merge \
  -p '{"data":{"url":"https://k3s.peuinjournal.com"}}'

kubectl rollout restart deployment argocd-server -n argocd
```

**5. Apply Ingress + TLS:**

```bash
kubectl apply -f infra/argocd/argocd-ingress.yaml
kubectl get certificate -n argocd
kubectl describe certificate argocd-tls -n argocd
```

Chờ `READY=True` (1–3 phút). Sau đó mở **https://k3s.peuinjournal.com**.

**6. Nếu vẫn bị HSTS chặn trên Edge/Chrome:**

- Mở `edge://net-internals/#hsts`
- **Delete domain security policies** → nhập `k3s.peuinjournal.com` → Delete
- Đóng tab, mở lại domain sau khi cert đã `READY=True`

**7. Debug nếu cert không cấp được:**

```bash
kubectl get ingress -n argocd
kubectl describe certificaterequest -n argocd
kubectl logs -n cert-manager deploy/cert-manager --tail=50
```

Thường gặp: DNS chưa trỏ đúng, port 80 bị firewall chặn (Let's Encrypt cần HTTP-01 qua port 80).
