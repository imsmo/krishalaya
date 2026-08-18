// apps/web-admin/src/app/support/emergency/page.tsx · W058, the emergency & safety desk (PC-56 ADMIN-SWEEP-b3).
//
// THE WAVE'S PRECONDITION, ANSWERED ON THE SCREEN: there is no paging provider, no alerting service, no vet lat/lng
// and no SQL distance on this platform — so this desk never prints "paged" or a kilometre figure. It is a REGISTER
// of human acts (0098's honest vocabulary: recorded / provider_pending), and the canon's "Emergency paging runs on
// the alerting service independently" error copy is replaced by the truth. The canon's "desk staffed · Arif M." is
// also not claimed: presence is recorded only as break exceptions (0133), so staffing cannot be measured honestly.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { categoryTone, stepTone } from '../../../features/support/emergency';

import { Button, EmptyState, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('em.title'), robots: { index: false, follow: false } };
}

interface Row {
  id: string; tenantId: string; ticketNo: string; categoryCode: string; channel: string;
  status: string; subject: string | null; age: string; tenantDistrict: string | null;
  responders: number; latestStep: { code: string; status: string } | null;
}

export default async function EmergencyDeskPage({ searchParams }: { searchParams: { cursor?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let rows: Row[] = []; let next: string | null = null; let notice: string | undefined;
  try {
    const r = await adminGet<Row[]>('support/emergency', { cursor: searchParams.cursor });
    rows = r.data; next = (r.meta as { nextCursor?: string | null } | undefined)?.nextCursor ?? null;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('hub.backQueue')}</Link></p>
      <h1>{t.t('em.heading')}</h1>
      <p className="kv-muted">{t.t('em.lead')}</p>
      {/* The canon's error copy claims an alerting service; none exists. The honest line stands even on success. */}
      {notice && <p className="kv-error" role="alert">{notice} {t.t('em.loadHonesty')}</p>}

      <table className="kv-table">
        <thead><tr>
          <th>{t.t('em.col.age')}</th><th>{t.t('em.col.case')}</th><th>{t.t('em.col.category')}</th>
          <th>{t.t('em.col.channel')}</th><th>{t.t('em.col.district')}</th><th>{t.t('em.col.status')}</th>
          <th>{t.t('em.col.step')}</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.age}</td>
              <td><Link href={`/support/emergency/${r.id}`}>{r.ticketNo}</Link></td>
              <td><StatusPill tone={categoryTone(r.categoryCode)} label={t.t(`em.cat.${r.categoryCode}`)} /></td>
              {/* channel is the ticket's DECLARED label — the b2 discipline holds here too */}
              <td>{r.channel}{r.channel !== 'app' ? t.t('hub.declaredMark') : ''}</td>
              <td>{r.tenantDistrict ?? t.t('common.dash')} <span className="kv-detail__muted">{t.t('em.districtNote')}</span></td>
              <td>{r.status} · {t.t('em.respondersN', { n: String(r.responders) })}</td>
              <td>
                {r.latestStep
                  ? <StatusPill tone={stepTone(r.latestStep.status)} label={`${t.t(`em.step.${r.latestStep.code}` as never)}${r.latestStep.status === 'provider_pending' ? t.t('em.pendingMark') : ''}`} />
                  : <span className="kv-detail__muted">{t.t('em.noSteps')}</span>}
              </td>
              <td><Button as={Link} href={`/support/emergency/${r.id}`} variant="tertiary">{t.t('em.open')}</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && !notice && <EmptyState title={t.t('em.allQuiet')} />}
      {next && <p className="kv-pager"><Link href={`/support/emergency?cursor=${encodeURIComponent(next)}`}>{t.t('common.next')}</Link></p>}

      {/* W058's protocols panel — with the honesty each canon line needs. */}
      <h2>{t.t('em.protocolsHeading')}</h2>
      <ul className="kv-list">
        <li><StatusPill tone={categoryTone('women_safety')} label={t.t('em.cat.women_safety')} /> {t.t('em.protocol.women_safety')}</li>
        <li><StatusPill tone={categoryTone('emergency_vet')} label={t.t('em.cat.emergency_vet')} /> {t.t('em.protocol.emergency_vet')}</li>
        <li><StatusPill tone={categoryTone('safety')} label={t.t('em.cat.safety')} /> {t.t('em.protocol.safety')}</li>
      </ul>
      <p className="kv-error" role="note">{t.t('em.pagingHonesty')}</p>
      <p className="kv-detail__muted">{t.t('em.threadHonesty')}</p>
      <p className="kv-detail__muted">{t.t('em.staffingHonesty')}</p>
    </section>
  );
}
