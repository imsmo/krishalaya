// ops/load-tests/k6-realtime-sockets.js · realtime-gateway socket soak — many concurrent WS subscribers.
// Gate: connections hold, server sheds gracefully past caps (RT_MAX_SUBSCRIPTIONS), no crash. CLUSTER-ONLY
// at PRD scale; PILOT_MODE scales the VU stages down to pilot infra (see ops/load-tests/pilot/README.md).
//
// S5 PATCH (Sprint S5):
//   1. `channel: 'listings:public'` does not exist and never did — the gateway's actual channel grammar
//      (apps/realtime-gateway/src/channels/contract.ts) only parses `t:<tenantId>:auction:<auctionId>`,
//      `t:<tenantId>:u:<userId>:orders`, and `t:<tenantId>:mcc:<mccId>`; there is no public/anonymous
//      channel — every kind is tenant-scoped and `canSubscribe` (auth/channel-authz.ts) fails closed on
//      anything else (`bad_channel`). The old script's WS handshake (101) would still succeed (auth
//      happens at connect via JWT, per apps/realtime-gateway/src/ws-server.ts), but the subscribe message
//      would silently get a `subscribe_denied` reply and never actually exercise fan-out — the check only
//      asserted the handshake, so this was passing green while testing nothing past connect.
//   2. Fixed to subscribe to `t:<TENANT_ID>:u:<userId>:orders` — each pilot buyer/farmer's own live
//      order-status feed, which `canSubscribe` allows for the token's own `sub` claim (own-channel,
//      Law: no IDOR) and matches the pilot's real use case (live order tracking during checkout).
//      `auctions` (needs the `auctions` feature flag, OFF for pilot) and `mcc` (needs `dairy.manage`,
//      dairy OFF for pilot) are not reachable pilot channels, so `user_orders` is the only valid one.
//   3. Added a token-pool (`TOKENS`, same `accessToken:refreshToken:userId` format as
//      k6-order-flow.js) so each VU subscribes as its OWN user instead of one shared TOKEN; falls back
//      to single-TOKEN for back-compat with existing PRD-scale invocations.
//   4. Added PILOT_MODE VU-stage override — 2000/5000 concurrent sockets is PRD-scale (target launch
//      load), not appropriate for a 2-node t3.medium pilot cluster or a 25-50 farmer population.
import ws from 'k6/ws';
import { check } from 'k6';

const URL = __ENV.WS_URL || 'wss://rt.krishalaya.com';
const TENANT_ID = __ENV.TENANT_ID || '';
const PILOT_MODE = (__ENV.PILOT_MODE || 'false') === 'true';

// TOKENS="accessToken1:refreshToken1:userId1,..." (see ops/load-tests/pilot/provision-loadtest-identities.mjs).
// Falls back to a single TOKEN+USER_ID pair for back-compat with pre-pilot invocations.
const TOKENS = (__ENV.TOKENS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => { const [accessToken, refreshToken, userId] = s.split(':'); return { accessToken, refreshToken, userId }; });
if (!TOKENS.length && __ENV.TOKEN && __ENV.USER_ID) {
  TOKENS.push({ accessToken: __ENV.TOKEN, refreshToken: '', userId: __ENV.USER_ID });
}

function pilotStages() {
  const sustainVUs = Number(__ENV.PILOT_RT_SUSTAIN_VUS || 20);
  const spikeVUs = Number(__ENV.PILOT_RT_SPIKE_VUS || 50);
  return [
    { duration: '1m', target: sustainVUs },
    { duration: '10m', target: sustainVUs },
    { duration: '1m', target: spikeVUs },
    { duration: '2m', target: spikeVUs },
    { duration: '1m', target: 0 },
  ];
}

export const options = {
  scenarios: { sockets: { executor: 'ramping-vus', startVUs: 0,
    stages: PILOT_MODE ? pilotStages() : [
      { duration: '2m', target: 2000 }, { duration: '10m', target: 5000 }, { duration: '3m', target: 0 },
    ] } },
};

export default function () {
  if (!TOKENS.length || !TENANT_ID) return;
  const token = TOKENS[(__VU - 1) % TOKENS.length];
  if (!token.accessToken || !token.userId) return;

  const channel = `t:${TENANT_ID}:u:${token.userId}:orders`;
  const res = ws.connect(`${URL}/ws?token=${token.accessToken}`, {}, (socket) => {
    socket.on('open', () => socket.send(JSON.stringify({ type: 'subscribe', channel })));
    let subscribed = false;
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'subscribed' && msg.channel === channel) subscribed = true;
        if (msg.type === 'subscribe_denied') socket.close();
      } catch { /* ignore malformed frames */ }
    });
    socket.setTimeout(() => { check(null, { 'subscribe acked (own order channel)': () => subscribed }); socket.close(); }, 60000);
  });
  check(res, { 'ws handshake 101': (r) => r && r.status === 101 });
}
