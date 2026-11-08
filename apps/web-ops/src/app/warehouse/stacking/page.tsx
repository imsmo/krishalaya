// apps/web-ops/src/app/warehouse/stacking/page.tsx · PC-56 OPS-2a · W374 (canon `warehouse/stacking`) — STACKING, AN HONEST PAGE THAT READS NOTHING:
// where goods sit in the warehouse is not recorded on this platform, and neither is pest control. No API call at all; zero inputs. `?form=` is the
// W3343–W3346 chain ("Log pest-control check") and `?act=` the W3347–W3349 chain ("Retry"), both DECOR; Back → here. Linked from the dashboard.
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { StackingView } from '../../../components/ops2/IntakeViews';
import { Ops2Chain } from '../../../components/ops2/Ops2Chain';
import { chain2State } from '../../../features/ops2/refusals';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops2.stacking.title'), robots: { index: false, follow: false } };
}

export default async function StackingPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/warehouse/stacking');
  const t = getTranslator();
  const form = chain2State('stacking_form', searchParams);
  if (form) return <Ops2Chain t={t} chain="stacking_form" state={form} />;
  const act = chain2State('stacking_act', searchParams);
  if (act) return <Ops2Chain t={t} chain="stacking_act" state={act} />;
  return <StackingView t={t} />;
}
