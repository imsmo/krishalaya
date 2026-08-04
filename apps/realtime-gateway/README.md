# realtime-gateway

WebSocket fan-out gateway for Krishalaya. **Stateless pods** behind a sticky load balancer; all state lives
in the sockets + **Redis Pub/Sub** (with capped **Redis Streams** for reconnect replay). It carries live
**auction bids**, **order-status** pushes, and **MCC dairy collection** dashboards. Scales to millions of
concurrent sockets by adding pods — no socket state on the pod, no pod-to-pod coupling.

## How it fits (end-to-end, nothing faked)

```
domain write → outbox (same tx) → relay → RealtimeFanoutHandler ──publish──▶ Redis Pub/Sub (t:{tenant}:…)
                                   (apps/api/src/core/realtime)                       │
                                                                                       ▼
                                          realtime-gateway pods  ──PSUBSCRIBE t:*──▶ WsServer.dispatch
                                                                                       │ (per-pod fan-out)
                                                                                       ▼
                                                                authorized, same-tenant sockets
```

- **Publisher** (in `apps/api`, runs in the relay/worker): `core/realtime` projects a domain event to a
  **NON-PII** message and publishes it to a tenant-scoped Redis channel. Gated by the `realtime_fanout` flag
  (default OFF) and resilience-wrapped (a Redis blip never stalls the outbox — Law 12).
- **Gateway** (this app): authenticates each socket with the **same access JWT** the api mints, authorizes
  every subscription, and forwards matching messages to local sockets with backpressure.

## Channels & authorization (the security boundary)

Grammar (`src/channels/contract.ts`, mirror of the api's canonical `core/realtime/realtime-channels.ts`):

| Channel | Who may subscribe |
|---|---|
| `t:{tenant}:auction:{id}` | any authenticated **member of that tenant** (spectating) |
| `t:{tenant}:u:{user}:orders` | **only that user** (private order timeline) |
| `t:{tenant}:mcc:{id}` | operators with the **`dairy.manage`** permission (or `*`) |

`src/auth/channel-authz.ts` (`canSubscribe`) makes every decision from the **verified JWT claims** + the
parsed channel, FAIL CLOSED. The tenant id is the first channel segment, so a cross-tenant subscription is
rejected by parse alone — defense in depth on top of the publisher only ever publishing to the right tenant.

## Threats considered (§4, adapted for a stateless socket gateway)

- **Auth / forgery.** Connections must present a valid, unexpired, correctly-signed **access** JWT (HS256
  pinned, iss/aud checked, `typ:'access'` required). Anything else → connection refused (4401). The gateway
  performs **no mutations** and trusts no client-asserted identity — only the token's `sub`/`tid`/`perms`.
- **Tenant isolation / IDOR.** `canSubscribe` denies cross-tenant channels (`cross_tenant`), another user's
  order timeline (`not_owner`), and the MCC dashboard without `dairy.manage` (`forbidden`). Unit-tested
  exhaustively (`__tests__/channel-authz.spec.ts`).
- **No PII on the wire.** Redaction happens at the **source** (the api projection): bidder/winner identities
  and sealed-bid amounts are never published; money is a **string in minor units** (Law 2). The gateway only
  forwards already-safe bytes.
- **Abuse / DoS / slow consumers.** Per-socket **max subscriptions**, **max frame size** (4 KB), and
  **slow-consumer eviction** (drop-oldest as the queue fills, then close 1013 when a client's send buffer
  backs up) protect the pod's memory at millions of sockets (`backpressure/policy.ts`, unit-tested).
- **Degrade, never die (Law 12).** A bad/oversized frame is ignored, not fatal; a single bad pub/sub message
  can't kill the pod; Redis is fire-and-forget with a capped-stream replay for reconnects. The whole feature
  is a `realtime_fanout` **flag flip** away from off (kill switch) — clients fall back to polling.
- **Fail closed on misconfig.** In production the gateway refuses to start without a strong `JWT_ACCESS_SECRET`
  and a `REDIS_URL` (`config.ts`).

## Endpoints
- `GET /ws` — WebSocket upgrade (auth via `Authorization: Bearer` or `?token=`). Client messages:
  `{"action":"subscribe","channel":"t:…"}` / `{"action":"unsubscribe",…}`. Server pushes `{type,channel,…}`.
- `GET /healthz` — liveness. `GET /metrics` — Prometheus text (no PII labels).

## Run / test
```bash
npm run typecheck
npm test            # pure security/backpressure/JWT units (no ws/Redis I/O)
npm run build && npm start
```
The Redis bus + the api publisher make this end-to-end; the live socket soak/load test runs in the cluster
(not the offline sandbox). Cross-pod presence totals and an authenticated replay-since API are deferred.
