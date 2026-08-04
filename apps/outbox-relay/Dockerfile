# apps/outbox-relay/Dockerfile · multi-stage, non-root. Build context = repo root.
#   docker build -f apps/outbox-relay/Dockerfile -t krishi/outbox-relay .
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/outbox-relay ./apps/outbox-relay
RUN pnpm install --no-frozen-lockfile && pnpm --filter @krishalaya/outbox-relay build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build /repo /repo
USER app
CMD ["node", "apps/outbox-relay/dist/main.js"]
