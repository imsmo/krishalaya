# apps/ivr-ussd-gateway/Dockerfile · multi-stage, non-root. Build context = repo root.
#   docker build -f apps/ivr-ussd-gateway/Dockerfile -t krishi/ivr-ussd-gateway .
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/ivr-ussd-gateway ./apps/ivr-ussd-gateway
RUN pnpm install --no-frozen-lockfile && pnpm --filter @krishalaya/ivr-ussd-gateway build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build /repo /repo
USER app
CMD ["node", "apps/ivr-ussd-gateway/dist/main.js"]
