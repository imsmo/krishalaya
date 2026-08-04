# infra/docker/web.Dockerfile · ONE image for ANY Next.js web app.
#   docker build -f infra/docker/web.Dockerfile \
#     --build-arg APP=web-storefront --build-arg APP_PKG=@krishalaya/web-storefront \
#     -t <ECR>/krishiverse-web-storefront:<tag> .
# Works for: web-storefront, web-tenant, web-admin, web-partner.
FROM node:20-alpine AS build
ARG APP_PKG
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json tsconfig*.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile=false \
  && pnpm --filter "${APP_PKG}..." build

FROM node:20-alpine AS runtime
ARG APP
ENV NODE_ENV=production PORT=3000
WORKDIR /repo/apps/${APP}
RUN apk add --no-cache tini curl && addgroup -S app && adduser -S app -G app
COPY --from=build /repo/apps/${APP}/.next ./.next
COPY --from=build /repo/apps/${APP}/public ./public
COPY --from=build /repo/apps/${APP}/package.json ./package.json
COPY --from=build /repo/apps/${APP}/next.config.js ./next.config.js
COPY --from=build /repo/node_modules /repo/node_modules
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "next", "start", "-p", "3000"]
