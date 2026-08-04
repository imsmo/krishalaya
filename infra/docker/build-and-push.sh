#!/usr/bin/env bash
# infra/docker/build-and-push.sh · build + push every launch-critical image to ECR (ap-south-1).
# Usage: ACCOUNT=123456789012 REGION=ap-south-1 TAG=$(git rev-parse --short HEAD) ./infra/docker/build-and-push.sh
set -euo pipefail

ACCOUNT="${ACCOUNT:?set ACCOUNT=<aws account id>}"
REGION="${REGION:-ap-south-1}"
TAG="${TAG:-latest}"
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# node services: <image-name>:<workspace-pkg>:<app-dir>
NODE_SERVICES=(
  "krishiverse-api:@krishalaya/api:api"
  "krishiverse-admin-api:@krishalaya/admin-api:admin-api"
  "krishiverse-wallet-service:@krishalaya/wallet-service:wallet-service"
  "krishiverse-worker:@krishalaya/worker:worker"
  "krishiverse-realtime-gateway:@krishalaya/realtime-gateway:realtime-gateway"
)
WEB_APPS=(
  "krishiverse-web-storefront:@krishalaya/web-storefront:web-storefront"
  "krishiverse-web-tenant:@krishalaya/web-tenant:web-tenant"
  "krishiverse-web-admin:@krishalaya/web-admin:web-admin"
  "krishiverse-web-partner:@krishalaya/web-partner:web-partner"
)

echo ">> ECR login"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR"

ensure_repo() { aws ecr describe-repositories --repository-names "$1" --region "$REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$1" --image-scanning-configuration scanOnPush=true \
       --region "$REGION" >/dev/null; }

echo ">> node-base"
ensure_repo krishiverse-node-base
docker build -f infra/docker/node-base.Dockerfile -t "$ECR/krishiverse-node-base:20" .
docker push "$ECR/krishiverse-node-base:20"

for entry in "${NODE_SERVICES[@]}"; do
  IFS=: read -r img pkg app <<< "$entry"
  echo ">> $img ($pkg)"; ensure_repo "$img"
  docker build -f infra/docker/node-service.Dockerfile \
    --build-arg RUNTIME_BASE="$ECR/krishiverse-node-base:20" \
    --build-arg APP="$app" --build-arg APP_PKG="$pkg" \
    -t "$ECR/$img:$TAG" .
  docker push "$ECR/$img:$TAG"
done

for entry in "${WEB_APPS[@]}"; do
  IFS=: read -r img pkg app <<< "$entry"
  echo ">> $img ($pkg)"; ensure_repo "$img"
  docker build -f infra/docker/web.Dockerfile \
    --build-arg APP="$app" --build-arg APP_PKG="$pkg" \
    -t "$ECR/$img:$TAG" .
  docker push "$ECR/$img:$TAG"
done

echo ">> ai-services"
ensure_repo krishiverse-ai-services
docker build -f infra/docker/ai-services.Dockerfile -t "$ECR/krishiverse-ai-services:$TAG" apps/ai-services
docker push "$ECR/krishiverse-ai-services:$TAG"

echo "DONE. Images pushed to $ECR with tag $TAG"
