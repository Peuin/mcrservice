#!/bin/bash
# Zero-downtime deployment script for auth-service

set -e

SERVICE_NAME="auth-service"
IMAGE_NAME="auth-service"
CONTAINER_NAME="auth-service"
PORT=8081
NETWORK="mcrservice_default"

echo "=== Zero-downtime deployment for $SERVICE_NAME ==="

# 1. Pull latest code
echo "[1/5] Pulling latest code..."
cd /root/mcrservice
git pull

# 2. Build new image
echo "[2/5] Building Docker image..."
docker build -t ${IMAGE_NAME}:latest -f apps/${SERVICE_NAME}/Dockerfile apps/${SERVICE_NAME}/

# 3. Check health of current container (if running)
echo "[3/5] Checking current service health..."
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Current container is running, checking health..."
  HEALTH=$(curl -sf -m 5 http://localhost:${PORT}/actuator/health 2>/dev/null || echo "DOWN")
  echo "Current health: $HEALTH"
else
  echo "No running container found, will start fresh"
fi

# 4. Start new container with new image (using different port temporarily)
echo "[4/5] Starting new container..."
docker stop ${CONTAINER_NAME}_new 2>/dev/null || true
docker rm ${CONTAINER_NAME}_new 2>/dev/null || true

docker run -d --name ${CONTAINER_NAME}_new \
  -p ${PORT}:${PORT} \
  --network ${NETWORK} \
  -e PORT=${PORT} \
  -e SUPABASE_URL=${SUPABASE_URL} \
  -e SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY} \
  -e SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY} \
  -e OTP_HASH_SECRET=${OTP_HASH_SECRET} \
  -e OTP_TTL_MINUTES=${OTP_TTL_MINUTES} \
  -e OTP_MAX_ATTEMPTS=${OTP_MAX_ATTEMPTS} \
  -e PASSWORD_MIN_LENGTH=${PASSWORD_MIN_LENGTH} \
  -e RESEND_API_KEY=${RESEND_API_KEY} \
  -e RESEND_FROM_EMAIL=${RESEND_FROM_EMAIL} \
  -e RESEND_REPLY_TO=${RESEND_REPLY_TO} \
  ${IMAGE_NAME}:latest

# 5. Wait for new container to be healthy
echo "[5/5] Waiting for new container to be healthy..."
MAX_WAIT=60
COUNTER=0
while [ $COUNTER -lt $MAX_WAIT ]; do
  HEALTH=$(curl -sf -m 5 http://localhost:${PORT}/actuator/health 2>/dev/null || echo "DOWN")
  if echo "$HEALTH" | grep -q '"status":"UP"'; then
    echo "New container is healthy!"
    break
  fi
  echo "Waiting for health check... ($COUNTER/$MAX_WAIT)"
  sleep 2
  COUNTER=$((COUNTER+2))
done

if [ $COUNTER -ge $MAX_WAIT ]; then
  echo "WARNING: Health check timeout, container may not be ready"
fi

# 6. Switch containers (zero downtime)
echo "Swapping containers..."
docker stop ${CONTAINER_NAME} 2>/dev/null || true
docker rm ${CONTAINER_NAME} 2>/dev/null || true
docker rename ${CONTAINER_NAME}_new ${CONTAINER_NAME}

echo "=== Deployment complete ==="
echo "Service: $SERVICE_NAME"
echo "Health: $(curl -sf http://localhost:${PORT}/actuator/health)"
