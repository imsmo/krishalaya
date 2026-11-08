// apps/web-ops/src/app/rates/page.tsx · PC-56 OPS-3c · W368 (canon `rates`) — THE PRICE: A READ OF THE APPROVED MILK RATE CARDS (founder Q1-A —
// built in HOTFIX-12 —, Q8-A, Q10-A, Q14-A, Q15-A, 2026-11-08). Two reads, both EXISTING: `GET /v1/dairy/rate-cards?activeOnly=true` (approved and
// active since HOTFIX-12; any signed-in member of the organisation may read it) and `GET /v1/config/flags` (whether premium slabs are switched
// off for everyone). Nothing is changed, computed, exported or written here: this console only READS rates (Q1-A).
// `?export=queued|ready` is the W3338–W3339 chain (DECOR) and `?act=confirm|success|failure` the W3340–W3342 chain (PARITY-DECOR), checked FIRST.
import type { Metadata } from 'next';
import { SdkError, type DairyRateCard } from '@krishalaya/sdk-js';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { RatesView } from '../../components/ops3/RatesView';
import { Ops3Chain } from '../../components/ops3/Ops3Chain';
import { chain3State } from '../../features/ops3/refusals';
import { approvedCards, ratesState, slabsPaid } from '../../features/ops3/rates';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops3.rates.title'), robots: { index: false, follow: false } };
}

export default async function RatesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/rates');
  const t = getTranslator(); const lang = getLang();
  const exp = chain3State('rate_export', searchParams);
  if (exp) return <Ops3Chain t={t} chain="rate_export" state={exp} />;
  const act = chain3State('rate_act', searchParams);
  if (act) return <Ops3Chain t={t} chain="rate_act" state={act} />;
  const c = opsClient();
  let cards: DairyRateCard[] = []; let status: 'ok' | number | 'failed' = 'ok';
  try { cards = await c.dairy.listRateCards({ activeOnly: true }); } catch (e) { status = e instanceof SdkError ? e.status : 'failed'; }
  let flags: Record<string, boolean> | null = null;
  if (status === 'ok') { try { flags = (await c.request<Record<string, boolean>>('GET', 'config/flags')).data; } catch { flags = null; } }
  return <RatesView t={t} lang={lang} state={ratesState(status, approvedCards(cards).length)} cards={cards} slabs={slabsPaid(flags)} />;
}
