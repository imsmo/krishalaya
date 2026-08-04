# apps/web-partner/Dockerfile · Next.js standalone, non-root. Build context = repo root.
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm --filter @krishalaya/web-partner build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/web-partner
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /repo/apps/web-partner/.next ./.next
COPY --from=build /repo/apps/web-partner/public ./public
COPY --from=build /repo/apps/web-partner/package.json ./package.json
COPY --from=build /repo/node_modules /repo/node_modules
USER app
EXPOSE 3000
CMD ["npx", "next", "start"]
