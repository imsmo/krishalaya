// apps/web-ops/src/app/pos/collect/page.tsx · PC-56 OPS-3a · W361 (canon `pos/collect`) — THE RECORD FORM (founder Q2-A, Q5-A, Q10-A). The centre in your
// custody (`GET /v1/dairy/mccs/mine`), its roll by member code only (`GET …/mccs/memberships/list?box=mcc&mccId=…&code=…`, keyset — OPS3-B14), and
// the form: member, shift, date (the organisation's today by default, never after it), weight, fat, SNF, flags. The form is a GET to the check step
// `/pos/quality`: nothing is recorded until "Record this pour" there. A person holding no custody gets no roll and no form.
import type { Metadata } from 'next';
import type { DairyMembership } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { PosCollectView } from '../../../components/ops3/CounterViews';
import { POS, ROLL_PAGE_SIZE, parseCode, parseId, parseReason } from '../../../features/ops3/counter';
import { loadCounter } from '../../../features/ops3/counter-load';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops3.pos.collect.title'), robots: { index: false, follow: false } }; }

export default async function PosCollectPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(POS.collect);
  const t = getTranslator(); const lang = getLang();
  const ctx = await loadCounter(parseId(searchParams?.mcc));
  const code = parseCode(searchParams?.code);
  const cursorRaw = searchParams?.cursor; const cursor = typeof cursorRaw === 'string' && /^[A-Za-z0-9+/=_-]{1,200}$/.test(cursorRaw) ? cursorRaw : undefined;
  let roll: DairyMembership[] | null = null; let nextCursor: string | null = null;
  if (ctx.centre) {
    try {
      const page = await opsClient().dairy.listMemberships({ box: 'mcc', mccId: ctx.centre.id, code: code ?? undefined, cursor, limit: ROLL_PAGE_SIZE });
      roll = page.items.filter((m) => m.mccId === ctx.centre?.id && m.isActive !== false); nextCursor = page.nextCursor;
    } catch { roll = null; }
  }
  const error = searchParams?.error ? parseReason({ reason: searchParams.error }) : null;
  return <PosCollectView t={t} lang={lang} state={ctx.state} centre={ctx.centre} centres={ctx.centres} today={ctx.today} roll={roll} code={code} nextCursor={nextCursor} error={error} />;
}
