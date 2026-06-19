#!/usr/bin/env bash
# Build mcrservice cho VPS AMD64, push GHCR và verify manifest.
#
# Usage:
#   export GITHUB_TOKEN="ghp_..."   # classic PAT: read:packages + write:packages + repo
#   export GITHUB_USER="nquynh2011199"
#   IMAGE_TAG=20260619-1200-amd64 bash scripts/ghcr-login-push.sh
#
# Tag mặc định: 0.1.0

set -euo pipefail

TAG="${IMAGE_TAG:-0.1.0}"
GITHUB_USER="${GITHUB_USER:-peuin}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="ghcr.io/${GITHUB_USER}/mcrservice:${TAG}"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: Thiếu GITHUB_TOKEN." >&2
  echo "Tạo classic PAT: GitHub → Settings → Developer settings → PAT → read:packages, write:packages, repo" >&2
  exit 1
fi

cd "$REPO_ROOT"

echo "[1/4] Login GHCR as ${GITHUB_USER}..."
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin

echo "[2/4] Build ${IMAGE} for linux/amd64..."
docker buildx build --platform linux/amd64 --load -t "$IMAGE" .

if [[ "$(docker image inspect "$IMAGE" --format '{{.Architecture}}')" != "amd64" ]]; then
  echo "ERROR: Image local không phải amd64." >&2
  exit 1
fi

echo "[3/4] Push ${IMAGE}..."
docker push "$IMAGE"

echo "[4/4] Verify registry manifest..."
docker buildx imagetools inspect "$IMAGE"
echo "OK: ${IMAGE} đã push với platform linux/amd64."

echo ""
echo "Tiếp theo trên VPS:"
echo "  GITHUB_TOKEN=... GITHUB_USER=${GITHUB_USER} bash scripts/k8s-create-ghcr-secret.sh"
echo "  Cập nhật infra/k8s-services.yaml sang ${IMAGE}, commit/push Git và sync Argo CD."
