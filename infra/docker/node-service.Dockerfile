# infra/docker/node-service.Dockerfile · ONE multi-stage image for ANY Node service in the monorepo.
# Build context = repo root. Select the service with --build-arg APP and APP_PKG:
#   docker build -f infra/docker/node-service.Dockerfile \
#     --build-arg APP=api --build-arg APP_PKG=@krishalaya/api -t <ECR>/krishiverse-api:<tag> .
# Works for: api, admin-api, wallet-service, worker, realtime-gateway.
ARG RUNTIME_BASE=node:20-alpine

# ---- build stage: install workspace, build the one target ----
FROM node:20-alpine AS build
ARG APP_PKG
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json tsconfig*.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile=false \
  && pnpm --filter "${APP_PKG}..." build

# ---- prune stage: production-only deps for the target app ----
FROM node:20-alpine AS prune
ARG APP_PKG
WORKDIR /repo
RUN corepack enable
COPY --from=build /repo /repo
# deploy a self-contained, prod-only node_modules tree for the app into /app
RUN pnpm --filter "${APP_PKG}" deploy --prod --legacy /app

# ---- runtime stage ----
FROM ${RUNTIME_BASE} AS runtime
ARG APP
ENV NODE_ENV=production APP_DIR=${APP}
WORKDIR /app
# tini + non-root if the base didn't provide them (plain node:20-alpine path)
USER root
RUN apk add --no-cache tini curl 2>/dev/null || true; \
    (getent group app || addgroup -S app); (id app 2>/dev/null || adduser -S app -G app)
COPY --from=prune --chown=app:app /app /app
USER app
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
