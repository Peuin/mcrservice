#!/usr/bin/env bash
# Tạo hoặc cập nhật imagePullSecret cho namespace mcrservice.
#
# Usage (chạy trên máy có kubectl trỏ tới cluster):
#   export GITHUB_TOKEN="ghp_..."
#   export GITHUB_USER="nquynh2011199"
#   bash scripts/k8s-create-ghcr-secret.sh

set -euo pipefail

NAMESPACE="${K8S_NAMESPACE:-mcrservice}"
SECRET_NAME="${SECRET_NAME:-ghcr-secret}"
GITHUB_USER="${GITHUB_USER:-nquynh2011199}"
GITHUB_EMAIL="${GITHUB_EMAIL:-${GITHUB_USER}@users.noreply.github.com}"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: Thiếu GITHUB_TOKEN (PAT với read:packages)." >&2
  exit 1
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "ERROR: kubectl không có trong PATH." >&2
  exit 1
fi

kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE"

kubectl delete secret "$SECRET_NAME" -n "$NAMESPACE" --ignore-not-found

kubectl create secret docker-registry "$SECRET_NAME" \
  --namespace "$NAMESPACE" \
  --docker-server=ghcr.io \
  --docker-username="$GITHUB_USER" \
  --docker-password="$GITHUB_TOKEN" \
  --docker-email="$GITHUB_EMAIL"

echo "OK: secret/${SECRET_NAME} trong namespace ${NAMESPACE}"
kubectl get secret "$SECRET_NAME" -n "$NAMESPACE"

echo ""
echo "Test pull từ trong cluster (nếu có crictl):"
echo "  kubectl run ghcr-test --rm -it --restart=Never -n ${NAMESPACE} \\"
echo "    --image=ghcr.io/${GITHUB_USER}/auth-service:0.1.0 \\"
echo "    --overrides='{\"spec\":{\"imagePullSecrets\":[{\"name\":\"${SECRET_NAME}\"}]}}' \\"
echo "    --command -- echo ok"
