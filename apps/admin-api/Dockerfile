# apps/admin-api/Dockerfile · multi-stage, non-root. Build context = repo root.
#   docker build -f apps/admin-api/Dockerfile -t krishi/admin-api .
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-api ./apps/admin-api
RUN pnpm install --no-frozen-lockfile && pnpm --filter @krishalaya/admin-api build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build /repo /repo
USER app
CMD ["node", "apps/admin-api/dist/main.js"]
