# infra/docker — container images

**Canonical Dockerfiles for CI/production** live here (one per runtime type, parametrized):

| File | Builds | How |
|------|--------|-----|
| `node-base.Dockerfile` | hardened shared runtime base (tini, non-root, curl) | build/push once as `krishalaya-node-base:20` |
| `node-service.Dockerfile` | ANY Node service (api, admin-api, wallet-service, worker, realtime-gateway) | `--build-arg APP=<dir> --build-arg APP_PKG=<pkg>` |
| `web.Dockerfile` | ANY Next.js app (web-storefront/tenant/admin/partner) | `--build-arg APP=<dir> --build-arg APP_PKG=<pkg>` |
| `ai-services.Dockerfile` | Python FastAPI inference service | context = `apps/ai-services` |

> The per-app `apps/*/Dockerfile` files are kept for quick local one-off builds. The **canonical** path for CI and
> the cluster is these generic Dockerfiles, driven by `build-and-push.sh`.

## Build + push everything to ECR
```bash
ACCOUNT=<aws-account-id> REGION=ap-south-1 TAG=$(git rev-parse --short HEAD) \
  ./infra/docker/build-and-push.sh
```
This logs into ECR, creates the repos (scan-on-push), and builds+pushes all launch-critical images. The Helm
charts reference these repos via `image.repository` + `image.tag` (see `infra/helm/*/values.yaml`).

## Notes
- Build context is the **repo root** (except ai-services). The root `.dockerignore` keeps `node_modules`, `.git`,
  `.env*`, `dist`, and `apps/mobile` out of the image — never ship secrets or build junk.
- Images run **non-root** under `tini` as PID 1. Healthchecks use `curl` against the app's `/healthz`.
- Deferred (Phase-2 services): stream-processor, analytics-pipeline, outbox-relay, ivr-ussd-gateway, whatsapp-bot —
  add them to `build-and-push.sh` when those services go live.
