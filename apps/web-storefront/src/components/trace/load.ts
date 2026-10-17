// apps/web-storefront/src/components/trace/load.ts · PC-56 STORE-5b — the trace pages' ONE read (scan / verify), shared by both chromes: the
// API's named refusals become a page state (never a guess), a lot of ANOTHER organisation on a store chrome is reported so the page can send the
// reader to the platform's own page (never rendered under this store's mark).
import 'server-only';
import type { TraceProvenance, TraceVerification } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient } from '../../lib/api-client';
import type { AccountChrome } from '../../features/store4a/account';
import { isOwnLot, isTraceToken, traceFailureOf, type TraceLoad } from '../../features/store5b/trace';

export type Loaded<T> = { kind: 'ok'; data: T } | { kind: 'other_org' } | { kind: TraceLoad };

async function read<T extends { organisation?: { slug?: string } }>(chrome: AccountChrome, token: string, fn: () => Promise<T>): Promise<Loaded<T>> {
  if (!isTraceToken(token)) return { kind: 'not_found' };
  try {
    const data = await fn();
    if (!isOwnLot(chrome, data.organisation?.slug ?? null)) return { kind: 'other_org' };
    return { kind: 'ok', data };
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    return { kind: traceFailureOf(err?.code ?? null, err?.status ?? null) };
  }
}
export function loadTrace(chrome: AccountChrome, token: string): Promise<Loaded<TraceProvenance>> {
  return read(chrome, token, () => publicClient().traceability.scan(token));
}
export function loadVerification(chrome: AccountChrome, token: string): Promise<Loaded<TraceVerification>> {
  return read(chrome, token, () => publicClient().traceability.verify(token));
}
