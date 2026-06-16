#!/usr/bin/env bash
# Bootstrap K3s: Argo CD, TLS (Let's Encrypt), worker-service manifests.
# Run on VPS as user with kubectl access (peuin or root):
#   cd /opt/mcrservice && git pull && bash scripts/vps-bootstrap.sh

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/mcrservice}"
DOMAIN="${DOMAIN:-k3s.peuinjournal.com}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.14.5}"

log() { echo "[bootstrap] $*"; }
kubectl_cmd() {
  if kubectl "$@" 2>/dev/null; then return 0; fi
  if sudo kubectl "$@"; then return 0; fi
  echo "ERROR: kubectl failed (try: sudo kubectl ...)" >&2
  exit 1
}

cd "$REPO_DIR" || { echo "Missing $REPO_DIR — clone repo first." >&2; exit 1; }

log "Checking cluster..."
kubectl_cmd cluster-info >/dev/null

# --- Argo CD ---
if ! kubectl_cmd get namespace argocd >/dev/null 2>&1; then
  log "Installing Argo CD..."
  kubectl_cmd create namespace argocd
  kubectl_cmd apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
else
  log "Namespace argocd exists — skipping install manifest"
fi

log "Waiting for Argo CD pods..."
kubectl_cmd wait --for=condition=Ready pods --all -n argocd --timeout=600s || true
kubectl_cmd get pods -n argocd

# --- cert-manager ---
if ! kubectl_cmd get namespace cert-manager >/dev/null 2>&1; then
  log "Installing cert-manager ${CERT_MANAGER_VERSION}..."
  kubectl_cmd apply -f "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"
  kubectl_cmd wait --for=condition=Available deployment/cert-manager -n cert-manager --timeout=300s
else
  log "cert-manager already installed"
fi

if [[ -f infra/cert-manager/letsencrypt-prod.yaml ]]; then
  log "Applying ClusterIssuer..."
  kubectl_cmd apply -f infra/cert-manager/letsencrypt-prod.yaml
fi

# --- Argo CD TLS / ingress ---
log "Configuring Argo CD for ingress TLS termination..."
kubectl_cmd patch configmap argocd-cmd-params-cm -n argocd --type merge \
  -p '{"data":{"server.insecure":"true"}}' 2>/dev/null || \
  kubectl_cmd create configmap argocd-cmd-params-cm -n argocd \
    --from-literal=server.insecure=true --dry-run=client -o yaml | kubectl_cmd apply -f -

kubectl_cmd patch configmap argocd-cm -n argocd --type merge \
  -p "{\"data\":{\"url\":\"https://${DOMAIN}\"}}"

kubectl_cmd rollout restart deployment argocd-server -n argocd
kubectl_cmd rollout status deployment argocd-server -n argocd --timeout=300s

if [[ -f infra/argocd/argocd-ingress.yaml ]]; then
  log "Applying Argo CD ingress..."
  kubectl_cmd apply -f infra/argocd/argocd-ingress.yaml
fi

# --- mcrservice namespace ---
if [[ -f infra/namespace/mcrservice-namespace.yaml ]]; then
  kubectl_cmd apply -f infra/namespace/mcrservice-namespace.yaml
fi

# --- worker-service secret (skip if exists) ---
if ! kubectl_cmd get secret worker-service-secret -n mcrservice >/dev/null 2>&1; then
  log "WARNING: worker-service-secret not found in mcrservice namespace."
  log "Create it manually, e.g.:"
  log "  kubectl create secret generic worker-service-secret -n mcrservice \\"
  log "    --from-literal=SUPABASE_URL=... \\"
  log "    --from-literal=SUPABASE_SERVICE_ROLE_KEY=... \\"
  log "    --from-literal=OTP_HASH_SECRET=..."
else
  log "worker-service-secret already exists"
fi

# --- Argo CD Application ---
if [[ -f argocd/worker-service-app.yaml ]]; then
  log "Applying Argo CD Application worker-service..."
  kubectl_cmd apply -f argocd/worker-service-app.yaml
fi

log "Waiting for TLS certificate (up to 3 min)..."
for i in $(seq 1 18); do
  ready="$(kubectl_cmd get certificate argocd-tls -n argocd -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
  if [[ "$ready" == "True" ]]; then
    log "Certificate argocd-tls is Ready"
    break
  fi
  sleep 10
done

echo ""
echo "========== STATUS =========="
kubectl_cmd get pods -n argocd
kubectl_cmd get ingress,certificate -n argocd 2>/dev/null || true
kubectl_cmd get applications -n argocd 2>/dev/null || true
kubectl_cmd get pods -n mcrservice 2>/dev/null || true

echo ""
echo "========== ARGO CD ADMIN =========="
if kubectl_cmd get secret argocd-initial-admin-secret -n argocd >/dev/null 2>&1; then
  pass="$(kubectl_cmd get secret argocd-initial-admin-secret -n argocd -o jsonpath='{.data.password}' | base64 -d)"
  echo "URL:      https://${DOMAIN}"
  echo "User:     admin"
  echo "Password: ${pass}"
else
  echo "Initial admin secret not ready yet — retry:"
  echo "  kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo"
fi

echo ""
echo "If https://${DOMAIN} still shows cert error, wait for READY=True then clear HSTS in browser."
echo "Temporary access: kubectl port-forward svc/argocd-server -n argocd 8080:443 --address 0.0.0.0"
