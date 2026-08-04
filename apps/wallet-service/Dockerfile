# apps/wallet-service/Dockerfile · multi-stage, non-root. Build context = repo root.
#   docker build -f apps/wallet-service/Dockerfile -t krishi/wallet-service .
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/wallet-service ./apps/wallet-service
RUN pnpm install --no-frozen-lockfile && pnpm --filter @krishalaya/wallet-service build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build /repo /repo
USER app
CMD ["node", "apps/wallet-service/dist/main.js"]
