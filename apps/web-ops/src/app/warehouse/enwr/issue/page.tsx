// apps/web-ops/src/app/warehouse/enwr/issue/page.tsx · PC-56 OPS-2b · W375 (canon `warehouse/enwr/issue`) — eNWR ISSUE, AN HONEST PAGE THAT READS
// NOTHING (founder Q3-A, 2026-11-06): "This platform does not issue an eNWR. No receipt is recorded here in a depositor's name." No API call at all;
// zero inputs. `?act=confirm|success|failure` is the W3315–W3317 chain (DECOR — "Send OTP to farmer", "Retry connection"; Back → here).
import type { Metadata } from 'next';
import { requireSession } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { EnwrIssueView } from '../../../../components/ops2/EnwrViews';
import { Ops2Chain } from '../../../../components/ops2/Ops2Chain';
import { chain2State } from '../../../../features/ops2/refusals';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops2.enwrIssue.title'), robots: { index: false, follow: false } };
}

export default async function EnwrIssuePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/warehouse/enwr/issue');
  const t = getTranslator();
  const act = chain2State('enwr_act', searchParams);
  if (act) return <Ops2Chain t={t} chain="enwr_act" state={act} />;
  return <EnwrIssueView t={t} />;
}
