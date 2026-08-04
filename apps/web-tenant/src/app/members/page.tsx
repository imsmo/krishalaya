// apps/web-tenant/src/app/members/page.tsx · FPO membership management (PC-28): the member roster
// (memberships.list — server-gated to membership.manage for the tenant-wide box) with a status filter +
// cancel action, and MEMBERSHIP TIERS (list + create + activate/deactivate; fees are float-free minor
// strings — a paid subscribe moves money server-side at the tier's authoritative price). Sections degrade
// independently (Law 12); everything under the `memberships` flag. noindex.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { MEMBERSHIP_STATUSES, isMembershipStatus } from '../../features/members/form';
import { createTierAction, setTierActiveAction, cancelMembershipAction } from './actions';
import type { MembershipTier, UserMembership } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('members.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['tier', 'activated', 'deactivated', 'cancelled']);
const ERR = new Set(['code', 'name', 'fee', 'tier', 'dup', 'cancel', 'illegal']);

export default async function MembersPage({ searchParams }: { searchParams: { status?: string; cursor?: string; ok?: string; error?: string } }) {
  await requireSession('/members');
  const t = getTranslator();
  const lang = getLang();
  const status = isMembershipStatus(searchParams.status) ? searchParams.status : undefined;

  let roster: UserMembership[] = []; let nextCursor: string | null = null; let rosterFailed = false;
  try {
    const p = await tenantClient().memberships.list({ box: 'all', status, cursor: searchParams.cursor, limit: 50 });
    roster = p.items; nextCursor = p.nextCursor;
  } catch { rosterFailed = true; }

  let tiers: MembershipTier[] = []; let tiersFailed = false;
  try { tiers = (await tenantClient().memberships.tiers({ limit: 50 })).items; }
  catch { tiersFailed = true; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const tierName = (id: string) => tiers.find((x) => x.id === id)?.defaultName ?? id.slice(0, 8);
  const pagerQs = (cursor: string) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('cursor', cursor);
    return `/members?${qs.toString()}`;
  };

  return (
    <section>
      <h1>{t.t('members.title')}</h1>
      <p className="kv-field__hint">{t.t('members.hint')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`members.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`members.error.${errKey}`)}</p>}

      <h2>{t.t('members.roster')}</h2>
      <form method="get" action="/members" className="kv-inline-form" role="search" aria-label={t.t('members.filterLabel')}>
        <label htmlFor="m-status" className="kv-field__label">{t.t('members.colStatus')}</label>
        <select id="m-status" name="status" defaultValue={status ?? ''} className="kv-input">
          <option value="">{t.t('members.status.any')}</option>
          {MEMBERSHIP_STATUSES.map((s) => <option key={s} value={s}>{t.t(`members.status.${s}`)}</option>)}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('members.apply')}</button>
      </form>
      {rosterFailed ? <p className="kv-error" role="alert">{t.t('members.loadError')}</p> : (
        <DataTable
          rows={roster}
          empty={t.t('members.rosterEmpty')}
          columns={[
            { header: t.t('members.colMember'), cell: (m) => m.userId.slice(0, 8) + '…' },
            { header: t.t('members.colTier'), cell: (m) => m.tierName ?? tierName(m.tierId) },
            { header: t.t('members.colCycle'), cell: (m) => t.t(`members.cycle.${m.billingCycle}`) || m.billingCycle },
            { header: t.t('members.colStatus'), cell: (m) => <span className="kv-badge">{t.t(`members.status.${m.status}`) || m.status}</span> },
            { header: t.t('members.colExpires'), cell: (m) => (m.expiresAt ? formatDate(m.expiresAt, lang) : t.t('common.dash')) },
            {
              header: t.t('members.colActions'),
              cell: (m) => (m.status === 'active' ? (
                <form action={cancelMembershipAction} className="kv-inline-form">
                  <input type="hidden" name="id" value={m.id} />
                  <button type="submit" className="kv-btn--link">{t.t('members.cancel')}</button>
                </form>
              ) : t.t('common.dash')),
            },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={pagerQs(nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}

      <h2>{t.t('members.tiers')}</h2>
      {tiersFailed ? <p className="kv-error" role="alert">{t.t('members.loadError')}</p> : (
        <DataTable
          rows={tiers}
          empty={t.t('members.tiersEmpty')}
          columns={[
            { header: t.t('members.colTier'), cell: (x) => x.defaultName },
            { header: t.t('members.colCode'), cell: (x) => <span className="kv-mono">{x.code}</span> },
            { header: t.t('members.colMonthly'), cell: (x) => (x.monthlyFeeMinor === '0' ? t.t('members.free') : formatMoneyMinor(x.monthlyFeeMinor, x.currencyCode ?? 'INR', lang)) },
            { header: t.t('members.colAnnual'), cell: (x) => (x.annualFeeMinor ? formatMoneyMinor(x.annualFeeMinor, x.currencyCode ?? 'INR', lang) : t.t('common.dash')) },
            {
              header: t.t('members.colActions'),
              cell: (x) => (
                <form action={setTierActiveAction} className="kv-inline-form">
                  <input type="hidden" name="id" value={x.id} />
                  <input type="hidden" name="active" value={x.isActive === false ? '1' : '0'} />
                  <button type="submit" className="kv-btn--link">{x.isActive === false ? t.t('members.activate') : t.t('members.deactivate')}</button>
                </form>
              ),
            },
          ]}
        />
      )}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('members.addTier')}</summary>
        <form action={createTierAction} className="kv-form">
          <label htmlFor="tr-code" className="kv-field__label">{t.t('members.colCode')}</label>
          <input id="tr-code" name="code" className="kv-input" required pattern="[A-Za-z0-9_]{2,40}" placeholder="gold" />
          <label htmlFor="tr-name" className="kv-field__label">{t.t('members.tierName')}</label>
          <input id="tr-name" name="name" className="kv-input" required minLength={2} maxLength={120} />
          <label htmlFor="tr-monthly" className="kv-field__label">{t.t('members.monthlyFee')}</label>
          <input id="tr-monthly" name="monthlyMajor" className="kv-input" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" placeholder="0" />
          <label htmlFor="tr-annual" className="kv-field__label">{t.t('members.annualFee')}</label>
          <input id="tr-annual" name="annualMajor" className="kv-input" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" />
          <p className="kv-field__hint">{t.t('members.feeHint')}</p>
          <button type="submit" className="kv-btn">{t.t('members.addTierBtn')}</button>
        </form>
      </details>
    </section>
  );
}
