# apps/web-tenant/Dockerfile · Next.js standalone, non-root. Build context = repo root.
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm --filter @krishalaya/web-tenant build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/web-tenant
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /repo/apps/web-tenant/.next ./.next
COPY --from=build /repo/apps/web-tenant/public ./public
COPY --from=build /repo/apps/web-tenant/package.json ./package.json
COPY --from=build /repo/node_modules /repo/node_modules
USER app
EXPOSE 3000
CMD ["npx", "next", "start"]
