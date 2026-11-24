# infra/docker/web.Dockerfile · ONE image for ANY Next.js web app.
#   docker build -f infra/docker/web.Dockerfile \
#     --build-arg APP=web-storefront --build-arg APP_PKG=@krishalaya/web-storefront \
#     --build-arg NEXT_PUBLIC_ENV="$(printf 'NEXT_PUBLIC_API_URL=https://api.example.com\n')" \
#     -t <ECR>/krishalaya-web-storefront:<tag> .
# Works for: web-storefront, web-tenant, web-admin, web-partner, web-gov, web-ops.
#
# PC-56 DEPLOY-1 — three faults fixed, each reproduced outside Docker before the change:
#  • the apps refuse to build without their NEXT_PUBLIC_* values (e.g. "web-storefront: NEXT_PUBLIC_API_URL is required"),
#    and the image passed none → NEXT_PUBLIC_ENV: the app's public build-time settings as dotenv text, written to
#    .env.production.local before `next build` (Next reads it at build). PUBLIC values only — they end up in the browser
#    bundle; never put a secret here. Server-only settings are injected at runtime by the Helm chart.
#  • the runtime stage copied only the root node_modules: pnpm keeps each app's `next` and its workspace links under
#    apps/<app>/node_modules, so `npx next start` found no next and DOWNLOADED next@latest (16.x) at every container
#    start → a prod-only, self-contained tree via `pnpm deploy --prod` (as node-service does), started with the app's
#    own pinned binary — never npx.
#  • `--frozen-lockfile=false` could build different dependency versions than CI tested → frozen.
FROM node:20-alpine AS build
ARG APP
ARG APP_PKG
ARG NEXT_PUBLIC_ENV=""
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc* turbo.json tsconfig*.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile \
  && printf '%s\n' "$NEXT_PUBLIC_ENV" > "apps/${APP}/.env.production.local" \
  && pnpm --filter "${APP_PKG}..." build \
  && pnpm --filter "${APP_PKG}" deploy --prod /app \
  && rm -rf /app/.next/cache

FROM node:20-alpine AS runtime
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apk add --no-cache tini curl && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app /app
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./node_modules/.bin/next", "start", "-p", "3000"]
