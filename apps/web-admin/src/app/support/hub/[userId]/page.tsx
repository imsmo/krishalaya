// apps/web-admin/src/app/support/hub/[userId]/page.tsx · W050's "all channels, one thread" panel
// (PC-56 ADMIN-SWEEP-b2).
//
// The deepest support read there is — one person's contacts across every tenant they touch — which is why the
// route sits behind `support.hub` and the SERVER writes an audit row for every open (support.hub_principal_read,
// the risk-profile-read doctrine). Identity arrives masked; each ticket links into the W049 case page, whose reply
// path is the ADMIN-2d rail — this page adds no second reply path for that honesty to rot in.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { slaText, slaClass, channelChip, type HubSla } from '../../../../features/support/hub';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('hub.threadTitle'), robots: { index: false, follow: false } };
}

interface Ticket {
  id: string; tenantId: string; ticketNo: string; channel: string; standing: string;
  severity: string; status: string; subject: string | null; sla: HubSla | null;
  createdAt: string; assigneeUserId: string | null; claimedByAdminId: string | null; mine: boolean;
}
interface Thread {
  userId: string; name: string | null; phone: string | null; languageCode: string | null; tickets: Ticket[];
}

export default async function HubPrincipalPage({ params }: { params: { userId: string } }) {
  requireAdmin();
  const t = getTranslator();

  let d: Thread | undefined; let notice: string | undefined;
  try { d = (await adminGet<Thread>(`support/hub/principal/${encodeURIComponent(params.userId)}`)).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  if (!d) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/support/hub">{t.t('hub.backHub')}</Link></p>
        <h1>{t.t('hub.threadHeading')}</h1>
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  return (
    <section>
      <p className="kv-backlink"><Link href="/support/hub">{t.t('hub.backHub')}</Link></p>
      <h1>{t.t('hub.threadHeading')} · {d.name ?? t.t('common.dash')}</h1>
      {/* The agent writes in THIS language — surfaced before any reply form (which lives on the case page). */}
      <p className="kv-muted">{d.phone ?? t.t('common.dash')} · {t.t('hub.writesIn', { lang: d.languageCode ?? '—' })}</p>
      {/* Opening this page was recorded — said to the operator, because a read that is audited silently breeds
          folklore about what is watched. */}
      <p className="kv-detail__muted">{t.t('hub.readRecorded')}</p>

      <table className="kv-table">
        <thead><tr>
          <th>{t.t('hub.col.sla')}</th><th>{t.t('hub.col.ticket')}</th><th>{t.t('hub.col.channel')}</th>
          <th>{t.t('hub.col.tenant')}</th><th>{t.t('hub.col.severity')}</th><th>{t.t('hub.col.owner')}</th><th></th>
        </tr></thead>
        <tbody>
          {d.tickets.map((x) => {
            const chip = channelChip({ channel: x.channel, standing: x.standing });
            const sla = x.sla ? slaText(x.sla) : null;
            return (
              <tr key={x.id}>
                <td>{sla ? <span className={slaClass(x.sla!)}>{t.t(`hub.sla.${sla.key}`, { t: sla.amount })}</span> : x.status}</td>
                <td>{x.ticketNo}<div className="kv-detail__muted">{x.subject ?? t.t('common.dash')}</div></td>
                <td><span className="kv-status">{chip.label}{chip.declared ? t.t('hub.declaredMark') : ''}</span></td>
                <td>{x.tenantId}</td>
                <td>{x.severity}</td>
                <td>{x.mine ? t.t('hub.owner.you') : x.claimedByAdminId ? t.t('hub.owner.platform') : x.assigneeUserId ? t.t('hub.owner.tenantAgent') : t.t('hub.owner.nobody')}</td>
                <td><Link href={`/support/tickets/${x.id}`} className="kv-btn kv-btn--link">{t.t('hub.openTicket')}</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {d.tickets.length === 0 && <p className="kv-empty">{t.t('hub.threadEmpty')}</p>}
      <p className="kv-detail__muted">{t.t('hub.identityDoctrine')}</p>
    </section>
  );
}
