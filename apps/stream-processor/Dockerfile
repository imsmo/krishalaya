# apps/stream-processor/Dockerfile · multi-stage, non-root. Build context = repo root.
#   docker build -f apps/stream-processor/Dockerfile -t krishi/stream-processor .
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/stream-processor ./apps/stream-processor
RUN pnpm install --no-frozen-lockfile && pnpm --filter @krishalaya/stream-processor build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build /repo /repo
USER app
CMD ["node", "apps/stream-processor/dist/main.js"]
