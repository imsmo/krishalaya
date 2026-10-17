// apps/web-partner/src/app/dashboard/page.tsx · PC-56 PARTNER-0 · founder D8 — the partner home over the PARTNER read (`/v1/partner/
// applications`: this partner's products, applicants' consent required — the API decides, on the kv_partner axis). Two list calls (the
// review queue and the approved list), each counted over ONE page with "N+" when the page was full, and the server's "as of". A 404 while
// `partner_console` is OFF prints the switched-off sentence, never an outage. Money summed as bigint minor units (Law 2). The partner's name
// comes from /v1/partner/me. All copy via i18n; no inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { partnerConsoleSwitch } from '../../lib/console-flag';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { SdkError, type PartnerApplication } from '@krishalaya/sdk-js';
import { pageCount, sumRequestedMinor } from '../../features/partner/application';

export const dynamic = 'force-dynamic';
const LIMIT = 100;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dash.title'), robots: { index: false, follow: false } };
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="kv-card kv-stat">
      <div className="kv-stat__label">{label}</div>
      <div className="kv-stat__value">{value}</div>
    </div>
  );
}

export default async function PartnerDashboard() {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  let review: { items: PartnerApplication[]; nextCursor: string | null; asOf: string | null } | null = null;
  let approved: { items: PartnerApplication[]; nextCursor: string | null } | null = null;
  let orgName: string | null = null;
  let notice: 'off' | 'unavailable' | null = null;
  try {
    const c = partnerClient();
    [review, approved] = await Promise.all([c.partner.applications.list({ reviewQueue: true, limit: LIMIT }), c.partner.applications.list({ status: 'approved', limit: LIMIT })]);
    orgName = (await c.partner.me().catch(() => null))?.organisation?.name ?? null;
  } catch (e) {
    notice = e instanceof SdkError && e.status === 404 && (await partnerConsoleSwitch()) === 'off' ? 'off' : 'unavailable';
  }
  if (notice === 'off') return <section><h1>{t.t('partner.off.title')}</h1><p className="kv-muted">{t.t('partner.off.body')}</p></section>;

  const show = (c: { n: number; atLeast: boolean }) => (c.atLeast ? t.t('partner.dash.atLeast', { count: c.n }) : String(c.n));
  return (
    <section>
      <h1>{t.t('dash.title')}</h1>
      <p className="kv-muted">{orgName ?? t.t('partner.shell.orgUnknown')}</p>
      <p className="kv-muted">{t.t('dash.lead')}</p>
      {notice === 'unavailable' && <p className="kv-error" role="alert">{t.t('dash.unavailable')}</p>}
      {review && approved && (
        <>
          <div className="kv-stat-row">
            <Stat label={t.t('dash.awaiting')} value={show(pageCount(review.items.length, review.nextCursor))} />
            <Stat label={t.t('dash.approved')} value={show(pageCount(approved.items.length, approved.nextCursor))} />
            <Stat label={t.t('dash.pendingExposure')} value={formatMoneyMinor(sumRequestedMinor(review.items), 'INR', lang)} />
          </div>
          <p className="kv-muted">{t.t('partner.dash.firstPage', { limit: LIMIT })}</p>
          {review.asOf && <p className="kv-muted">{t.t('partner.dash.asOf', { time: formatDate(review.asOf, lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
        </>
      )}
      <p className="kv-pager"><Link className="kv-btn" href="/loan-queue">{t.t('dash.openQueue')}</Link></p>
    </section>
  );
}
