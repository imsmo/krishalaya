#!/usr/bin/env bash
# infra/docker/build-and-push.sh · build + push every launch-critical image to ECR (ap-south-1).
# Usage: ACCOUNT=123456789012 REGION=ap-south-1 TAG=$(git rev-parse --short HEAD) ./infra/docker/build-and-push.sh
#
# Web apps bake their NEXT_PUBLIC_* settings into the browser bundle at BUILD time. Give each app its public settings
# as dotenv text in NEXT_PUBLIC_ENV_<APP> (app dir upper-cased, '-' → '_'), e.g.
#   NEXT_PUBLIC_ENV_WEB_STOREFRONT=$'NEXT_PUBLIC_API_URL=https://api.example.com\nNEXT_PUBLIC_SITE_URL=https://example.com'
# PUBLIC values only — never a secret (they ship to every browser). A web app without its settings fails its build on
# purpose ("NEXT_PUBLIC_API_URL is required"), so a misconfigured image is never pushed.
#
# PC-56 DEPLOY-1: images are built for linux/amd64 (the EKS nodes are t3, x86) — on an Apple-silicon Mac `docker build`
# defaults to arm64 and every pod would die with "exec format error"; web-gov and web-ops added; NEXT_PUBLIC_ENV wired.
set -euo pipefail

ACCOUNT="${ACCOUNT:?set ACCOUNT=<aws account id>}"
REGION="${REGION:-ap-south-1}"
TAG="${TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# node services: <image-name>:<workspace-pkg>:<app-dir>
NODE_SERVICES=(
  "krishalaya-api:@krishalaya/api:api"
  "krishalaya-admin-api:@krishalaya/admin-api:admin-api"
  "krishalaya-wallet-service:@krishalaya/wallet-service:wallet-service"
  "krishalaya-worker:@krishalaya/worker:worker"
  "krishalaya-realtime-gateway:@krishalaya/realtime-gateway:realtime-gateway"
)
WEB_APPS=(
  "krishalaya-web-storefront:@krishalaya/web-storefront:web-storefront"
  "krishalaya-web-tenant:@krishalaya/web-tenant:web-tenant"
  "krishalaya-web-admin:@krishalaya/web-admin:web-admin"
  "krishalaya-web-partner:@krishalaya/web-partner:web-partner"
  "krishalaya-web-gov:@krishalaya/web-gov:web-gov"
  "krishalaya-web-ops:@krishalaya/web-ops:web-ops"
)

echo ">> ECR login"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR"

ensure_repo() { aws ecr describe-repositories --repository-names "$1" --region "$REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$1" --image-scanning-configuration scanOnPush=true \
       --region "$REGION" >/dev/null; }

echo ">> node-base"
ensure_repo krishalaya-node-base
docker build --platform "$PLATFORM" -f infra/docker/node-base.Dockerfile -t "$ECR/krishalaya-node-base:20" .
docker push "$ECR/krishalaya-node-base:20"

for entry in "${NODE_SERVICES[@]}"; do
  IFS=: read -r img pkg app <<< "$entry"
  echo ">> $img ($pkg)"; ensure_repo "$img"
  docker build --platform "$PLATFORM" -f infra/docker/node-service.Dockerfile \
    --build-arg RUNTIME_BASE="$ECR/krishalaya-node-base:20" \
    --build-arg APP="$app" --build-arg APP_PKG="$pkg" \
    -t "$ECR/$img:$TAG" .
  docker push "$ECR/$img:$TAG"
done

for entry in "${WEB_APPS[@]}"; do
  IFS=: read -r img pkg app <<< "$entry"
  var="NEXT_PUBLIC_ENV_$(echo "$app" | tr '[:lower:]-' '[:upper:]_')"
  echo ">> $img ($pkg) — public settings from \$$var"; ensure_repo "$img"
  docker build --platform "$PLATFORM" -f infra/docker/web.Dockerfile \
    --build-arg APP="$app" --build-arg APP_PKG="$pkg" \
    --build-arg NEXT_PUBLIC_ENV="${!var:-}" \
    -t "$ECR/$img:$TAG" .
  docker push "$ECR/$img:$TAG"
done

echo ">> ai-services"
ensure_repo krishalaya-ai-services
docker build --platform "$PLATFORM" -f infra/docker/ai-services.Dockerfile -t "$ECR/krishalaya-ai-services:$TAG" apps/ai-services
docker push "$ECR/krishalaya-ai-services:$TAG"

echo "DONE. Images pushed to $ECR with tag $TAG"
