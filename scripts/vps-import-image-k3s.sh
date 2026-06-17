#!/usr/bin/env bash
# Workaround khi GHCR báo "denied": build trên VPS và import vào K3s, không cần registry.
#
# Chạy TRÊN VPS (cần docker + k3s):
#   cd /opt/mcrservice
#   bash scripts/vps-import-image-k3s.sh auth-service
#
# Sau đó patch deployment dùng image local (xem DEPLOY_ARGOCD.md mục H).

set -euo pipefail

SERVICE="${1:-auth-service}"
TAG="${IMAGE_TAG:-0.1.0}"
LOCAL_IMAGE="${SERVICE}:${TAG}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$REPO_ROOT"

echo "[1/3] Build ${LOCAL_IMAGE}..."
docker build -t "$LOCAL_IMAGE" -f "apps/${SERVICE}/Dockerfile" .

echo "[2/3] Import vào K3s containerd..."
docker save "$LOCAL_IMAGE" | sudo k3s ctr images import -

echo "[3/3] Image trong K3s:"
sudo k3s ctr images ls | grep "$SERVICE" || true

echo ""
echo "Patch deployment tạm dùng image local (không pull GHCR):"
cat <<EOF
kubectl -n mcrservice set image deployment/${SERVICE} \\
  ${SERVICE}=${LOCAL_IMAGE}
kubectl -n mcrservice patch deployment ${SERVICE} --type=json \\
  -p='[{"op":"remove","path":"/spec/template/spec/imagePullSecrets"}]'
kubectl -n mcrservice patch deployment ${SERVICE} -p \\
  '{"spec":{"template":{"spec":{"containers":[{"name":"${SERVICE}","imagePullPolicy":"IfNotPresent"}]}}}}'
EOF
