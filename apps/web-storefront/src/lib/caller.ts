// apps/web-storefront/src/lib/caller.ts · PC-56 STORE-1a · C2 — the per-request header hook the SDK calls before every API request
// (`createClient({ getHeaders })`): the buyer's address, signed (lib/caller-sign.ts). Outside a request (build time, a static render)
// there is no buyer, so nothing is sent.
import 'server-only';
import { headers } from 'next/headers';
import { serverEnv } from './server-env';
import { clientIpFromForwarded, signedClientHeaders } from './caller-sign';

export function callerHeaders(): Record<string, string> {
  if (!serverEnv.callerSecret) return {};
  let xff: string | null = null;
  try { xff = headers().get('x-forwarded-for'); } catch { return {}; }
  return signedClientHeaders(clientIpFromForwarded(xff, serverEnv.trustProxy), serverEnv.callerSecret);
}
