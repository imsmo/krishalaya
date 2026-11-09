// apps/web-ops/src/app/pos/slip/page.tsx · PC-56 OPS-3a · W363 (canon `pos/slip`) — "WHAT WAS RECORDED", a READ (founder Q3-A, Q10-A, Q11-A). The SERVER's
// answer to the record act, kept for this browser by `recordPourAction` (DELTA `slip_source`: a counter person cannot list a member's pours
// since OPS-3p), and the card that priced it by its id (`GET /v1/dairy/rate-cards`). `?act=success` (W3336) prints the chain's success
// sentence above it. No slip number, QR, print, reprint or SMS; no member name. Retry (FM:38) re-reads this page — PARITY-DECOR.
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { DairyRateCard } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { PosSlipView, WhatWasRecorded } from '../../../components/ops3/CounterViews';
import { Ops3Chain } from '../../../components/ops3/Ops3Chain';
import { chain3State } from '../../../features/ops3/refusals';
import { POS, SLIP_COOKIE, decodeRecorded } from '../../../features/ops3/counter';
import { loadCounter } from '../../../features/ops3/counter-load';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops3.pos.slip.title'), robots: { index: false, follow: false } }; }

export default async function PosSlipPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(POS.slip);
  const t = getTranslator(); const lang = getLang();
  const pour = decodeRecorded(cookies().get(SLIP_COOKIE)?.value);
  let card: DairyRateCard | null = null; let cardRead = false;
  if (pour) { try { card = (await opsClient().dairy.listRateCards({})).find((c) => c.id === pour.rateCardId) ?? null; cardRead = true; } catch { cardRead = false; } }
  const ctx = pour ? await loadCounter(pour.mccId) : null;
  const centre = ctx?.centre ?? null;
  if (chain3State('pos_act', searchParams) === 'success' && pour) {
    return <Ops3Chain t={t} chain="pos_act" state="success" back={`${POS.collect}?mcc=${pour.mccId}`} backKey="ops3.pos.slip.next"><WhatWasRecorded t={t} lang={lang} pour={pour} card={card} cardRead={cardRead} /></Ops3Chain>;
  }
  return <PosSlipView t={t} lang={lang} state={pour ? 'ok' : 'none'} pour={pour} card={card} cardRead={cardRead} centre={centre} />;
}
