# apps/whatsapp-bot/Dockerfile · multi-stage, non-root. Build context = repo root.
#   docker build -f apps/whatsapp-bot/Dockerfile -t krishi/whatsapp-bot .
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/whatsapp-bot ./apps/whatsapp-bot
RUN pnpm install --no-frozen-lockfile && pnpm --filter @krishalaya/whatsapp-bot build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build /repo /repo
USER app
CMD ["node", "apps/whatsapp-bot/dist/main.js"]
