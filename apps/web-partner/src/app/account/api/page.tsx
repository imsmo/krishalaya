// apps/web-partner/src/app/account/api/page.tsx · PC-56 PARTNER-1b · founder D1 — API KEYS (canon W267, its own path `account/api`).
// Reads `GET /v1/partner/keys` (every partner role). `?act=revoke&id=…` is the REAL revoke chain (W2911 confirm — the Idempotency-Key minted
// HERE at render, in a hidden field; the reason typed on the confirm step — W2912 `&state=success` · W2913 `&state=failure&code=`);
// `?form=error|review|success|failure` the Create-key chain (W2907–W2910, DECOR: keys are issued by the platform's partner operations).
// A 404 while `partner_console` is OFF prints the switched-off sentence; a 403 says the role does not include it.
// components/partner1/{KeysView,RevokeChain}.tsx render.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { SdkError, type PartnerKey } from '@krishalaya/sdk-js';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { partnerConsoleSwitch } from '../../../lib/console-flag';
import { partnersMailbox } from '../../../lib/partners-mailbox';
import { ChainNotice } from '../../../components/partner1/ChainNotice';
import { KeysView, type KeysState } from '../../../components/partner1/KeysView';
import { RevokeConfirm, RevokeFailure, RevokeSuccess } from '../../../components/partner1/RevokeChain';
import { chainState } from '../../../features/partner1/refusals';
import { revokeState } from '../../../features/partner1/keys';
import { failureOf } from '../../../features/partner1/dashboard';
import { revokeKeyAction } from './actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner1.keys.title'), robots: { index: false, follow: false } };
}

export default async function KeysPage({ searchParams }: { searchParams?: SP }) {
  const persona = await requirePartner();
  const t = getTranslator(); const lang = getLang();
  const form = chainState('keys_form', searchParams);
  if (form) return <ChainNotice t={t} chain="keys_form" state={form} />;

  let keys: PartnerKey[] = []; let state: KeysState = 'ok';
  try { keys = await partnerClient().partner.keys.list(); } catch (e) {
    const status = e instanceof SdkError ? e.status : undefined;
    state = status === 403 ? 'forbidden' : failureOf(status, status === 404 ? await partnerConsoleSwitch() : 'unknown');
  }
  const revoke = revokeState(searchParams);
  if (revoke && state === 'ok') {
    const row = keys.find((k) => k.id === revoke.id) ?? null;
    if (revoke.step === 'success') return <RevokeSuccess t={t} lang={lang} keyRow={row} />;
    if (revoke.step === 'failure') return <RevokeFailure t={t} id={revoke.id} code={revoke.code} />;
    return <RevokeConfirm t={t} keyRow={row} idempotencyKey={randomUUID()} action={revokeKeyAction} />;
  }
  const canRevoke = (persona.perms ?? []).includes('partner.keys.revoke');
  return <KeysView t={t} lang={lang} state={state} keys={keys} canRevoke={canRevoke} mailbox={await partnersMailbox()} />;
}
