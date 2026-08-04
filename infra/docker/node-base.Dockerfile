# infra/docker/node-base.Dockerfile · hardened runtime base for all Node services.
# Build + push ONCE, then service images use it as their runtime base:
#   docker build -f infra/docker/node-base.Dockerfile -t <ECR>/krishalaya-node-base:20 .
#   docker push <ECR>/krishalaya-node-base:20
# (Optional accelerator — node-service.Dockerfile defaults to plain node:20-alpine if you skip this.)
FROM node:20-alpine
# tini = proper PID 1 (signal handling, zombie reaping); curl for container healthchecks
RUN apk add --no-cache tini curl \
  && corepack enable \
  && addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production
WORKDIR /repo
USER app
ENTRYPOINT ["/sbin/tini", "--"]
