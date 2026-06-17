#!/usr/bin/env bash
# Build + push image lên GHCR và verify pull được.
#
# Usage:
#   export GITHUB_TOKEN="ghp_..."   # classic PAT: read:packages + write:packages + repo
#   export GITHUB_USER="nquynh2011199"
#   bash scripts/ghcr-login-push.sh auth-service
#   bash scripts/ghcr-login-push.sh worker-service
#
# Tag mặc định: 0.1.0

set -euo pipefail

SERVICE="${1:-auth-service}"
TAG="${IMAGE_TAG:-0.1.0}"
GITHUB_USER="${GITHUB_USER:-nquynh2011199}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="ghcr.io/${GITHUB_USER}/${SERVICE}:${TAG}"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: Thiếu GITHUB_TOKEN." >&2
  echo "Tạo classic PAT: GitHub → Settings → Developer settings → PAT → read:packages, write:packages, repo" >&2
  exit 1
fi

cd "$REPO_ROOT"

echo "[1/4] Login GHCR as ${GITHUB_USER}..."
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin

echo "[2/4] Build ${IMAGE}..."
docker build -t "$IMAGE" -f "apps/${SERVICE}/Dockerfile" .

echo "[3/4] Push ${IMAGE}..."
docker push "$IMAGE"

echo "[4/4] Verify pull (anonymous + logged in)..."
docker pull "$IMAGE"
echo "OK: ${IMAGE} tồn tại và pull được với token hiện tại."

echo ""
echo "Tiếp theo trên VPS:"
echo "  GITHUB_TOKEN=... GITHUB_USER=${GITHUB_USER} bash scripts/k8s-create-ghcr-secret.sh"
echo "  kubectl rollout restart deployment/${SERVICE} -n mcrservice"
