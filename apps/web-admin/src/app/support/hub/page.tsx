// apps/web-admin/src/app/support/hub/page.tsx · W050, the communication hub (PC-56 ADMIN-SWEEP-b2).
//
// ONE THREAD PER PRINCIPAL, and the join key is users.id — the phone is only its proof (UNIQUE and global since
// 0003), which is the whole channel-identity decision this wave had to make before drawing anything: no phone
// search exists on this page, identity arrives masked from the server, and the cross-tenant grouping the canon asks
// for creates no NEW linkage because identity was already platform-wide. See 0133's header for the decision in full.
//
// AND THE CHANNEL HONESTY: W050 draws "app chat · WhatsApp · IVR callbacks · SMS replies in one queue". Only in-app
// chat is a channel this platform actually carries; whatsapp/ivr/sms are CALLER-DECLARED labels on tickets (both
// gateway apps are intentional stubs, the SMS wiring is OTP-only, no inbound-message controller exists). The chips
// say declared-not-verified, and the missing rail is named at the foot rather than faked with an icon.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { hubTakeNextAction, hubPresenceAction } from '../actions';
import { slaText, slaClass, channelChip, presenceAction, takeNextBlockedKey, type HubSla } from '../../../features/support/hub';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('hub.title'), robots: { index: false, follow: false } };
}

interface Row {
  userId: string; name: string | null; phone: string | null; languageCode: string | null;
  openTickets: number; tenants: number; channels: { channel: string; standing: string }[];
  worstSeverity: string | null; sla: HubSla;
  latestTicketId: string; latestSubject: string | null; latestChannel: string; waitingSince: string;
}
interface Meta {
  nextCursor: string | null; myLoad: number; unclaimed: number; orphans: number;
  presence: 'available' | 'break'; presenceSince: string | null; carriedChannels: string[];
}

const OK = new Set(['onBreak', 'available']);
const ERR = new Set(['onBreak', 'status', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function CommHubPage({ searchParams }: { searchParams: { cursor?: string; ok?: string; error?: string; empty?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let rows: Row[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const r = await adminGet<Row[]>('support/hub', { cursor: searchParams.cursor });
    rows = r.data; meta = r.meta as unknown as Meta;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const pa = meta ? presenceAction(meta.presence) : null;
  const blocked = meta ? takeNextBlockedKey({ presence: meta.presence, unclaimed: meta.unclaimed }) : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('hub.backQueue')}</Link></p>
      <h1>{t.t('hub.heading')}</h1>
      <p className="kv-muted">{t.t('hub.lead')}</p>
      {notice && <p className="kv-error" role="alert">{notice}</p>}
      {/* W2100/W2101 as states: the action's outcome (or refusal, with nothing changed) lands here. */}
      {okKey && <p className="kv-success" role="status">{t.t(`hub.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`hub.error.${errKey}`)}</p>}
      {searchParams.empty === 'nothingToClaim' && <p className="kv-notice" role="note">{t.t('hub.nothingToClaim')}</p>}

      {meta && (
        <>
          {/* The canon's decor "My load: 6 open" is a real, server-computed figure here. */}
          <p>
            <span className="kv-status">{t.t('hub.myLoad', { n: String(meta.myLoad) })}</span>{' '}
            <span className="kv-status">{t.t('hub.unclaimed', { n: String(meta.unclaimed) })}</span>{' '}
            {meta.presence === 'break' && <span className="kv-status kv-status--warn">{t.t('hub.onBreakSince', { t: meta.presenceSince ?? '' })}</span>}
          </p>
          {/* W2099's confirm is the pair of forms: each states its consequence; the audit row carries actor+reason. */}
          <form action={hubTakeNextAction} style={{ display: 'inline' }}>
            <button type="submit" className="kv-btn" disabled={blocked !== null}>{t.t('hub.takeNext')}</button>
          </form>{' '}
          {pa && (
            <form action={hubPresenceAction} style={{ display: 'inline' }}>
              <input type="hidden" name="status" value={pa.to} />
              <button type="submit" className="kv-btn kv-btn--secondary">{t.t(`hub.${pa.key}`)}</button>
            </form>
          )}
          {blocked && <p className="kv-detail__muted">{t.t(`hub.blocked.${blocked}`)}</p>}
        </>
      )}

      <table className="kv-table">
        <thead><tr>
          <th>{t.t('hub.col.sla')}</th><th>{t.t('hub.col.principal')}</th><th>{t.t('hub.col.channels')}</th>
          <th>{t.t('hub.col.latest')}</th><th>{t.t('hub.col.open')}</th><th>{t.t('hub.col.severity')}</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const sla = slaText(r.sla);
            return (
              <tr key={r.userId}>
                <td><span className={slaClass(r.sla)}>{t.t(`hub.sla.${sla.key}`, { t: sla.amount })}</span></td>
                <td>
                  <Link href={`/support/hub/${r.userId}`}>{r.name ?? t.t('common.dash')}</Link>
                  <div className="kv-detail__muted">{r.phone ?? t.t('common.dash')} · {r.languageCode}</div>
                </td>
                <td>
                  {r.channels.map((c) => {
                    const chip = channelChip(c);
                    return <span key={c.channel} className="kv-status">{chip.label}{chip.declared ? t.t('hub.declaredMark') : ''}</span>;
                  })}
                </td>
                <td>{r.latestSubject ?? t.t('common.dash')}</td>
                <td>{r.openTickets}{r.tenants > 1 ? ` · ${t.t('hub.tenants', { n: String(r.tenants) })}` : ''}</td>
                <td>{r.worstSeverity ?? t.t('common.dash')}</td>
                <td><Link href={`/support/tickets/${r.latestTicketId}`} className="kv-btn kv-btn--link">{t.t('hub.openTicket')}</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && !notice && (
        // W050's inbox-zero, with its break offer — and the offer is the REAL presence control, not a sticker.
        <p className="kv-empty">{t.t('hub.inboxZero')}</p>
      )}
      {meta && meta.orphans > 0 && (
        // Tickets with no requester recorded do not fit a person-grouped inbox; they are counted and pointed at,
        // never silently dropped.
        <p className="kv-detail__muted">{t.t('hub.orphans', { n: String(meta.orphans) })} <Link href="/support">{t.t('hub.orphansLink')}</Link></p>
      )}
      {meta?.nextCursor && <p className="kv-pager"><Link href={`/support/hub?cursor=${encodeURIComponent(meta.nextCursor)}`}>{t.t('common.next')}</Link></p>}

      <p className="kv-detail__muted">{t.t('hub.identityDoctrine')}</p>
      <p className="kv-error" role="note">{t.t('hub.channelsHonesty')}</p>
      <p className="kv-detail__muted">{t.t('hub.routingHonesty')}</p>
    </section>
  );
}
