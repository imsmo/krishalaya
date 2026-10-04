// apps/web-tenant/src/app/money/commission/page.tsx · W149 · Commission rules — PC-56 TENANT-SW-a.
//
// The table the canon draws (Scope · Source · Rate · Cap · Charged to · Effective · Priority · Status) over the API's rules, the
// platform share as a READ-ONLY column whose value is the tenant's PLAN floor ("set by your plan: N bps" — never a tenant field, F-3),
// the pending proposals with Confirm offered only to a different administrator (the database re-judges), the W149 resolution example
// (asked of the API, never computed here), the history (ended / inactive rows included), and every state: platform defaults only,
// couldn't load (Retry), restricted, flagged off, loading (the route's loading.tsx).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { CommissionRule, CommissionRuleProposal, CommissionPolicy, CommissionResolution } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { tenantHasPerm } from '../../../lib/auth';
import { getTranslator, getLang } from '../../../lib/i18n';
import { DataTable } from '../../../components/DataTable';
import { COMMISSION_HREF, COMMISSION_SOURCES, bpsPercent, pageState } from '../../../features/swa/console';
import { AsOf } from '../../../components/AsOf';
import { asOfLabels } from '../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swa.com.title'), robots: { index: false, follow: false } }; }

export default async function CommissionPage({ searchParams }: { searchParams: { source?: string; history?: string } }) {
  await requireSession(COMMISSION_HREF);
  const t = getTranslator(); const lang = getLang();
  const day = (ymd: string | null) => (ymd ? formatDate(`${ymd}T00:00:00+05:30`, lang, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
  const money = (m: string | null) => (m ? formatMoneyMinor(m, 'INR', lang) : t.t('common.dash'));
  const canManage = tenantHasPerm('commission.manage');
  const history = searchParams.history === '1';
  const source = (COMMISSION_SOURCES as readonly string[]).includes(searchParams.source ?? '') ? searchParams.source : undefined;

  let rules: CommissionRule[] = []; let share: number | null = null; let state: string | null = null;
  try {
    const page = await tenantClient().tenantConfig.commissionRules({ includePlatformDefaults: true, activeOnly: !history, limit: 100 });
    rules = page.items; share = page.platformShareBps;
  } catch (e) { state = pageState(e instanceof SdkError ? e.status : undefined, true); }
  let policy: CommissionPolicy | null = null; let proposals: CommissionRuleProposal[] = []; let example: CommissionResolution | null = null;
  if (!state) {
    const [p, q, x] = await Promise.allSettled([
      tenantClient().tenantConfig.commissionPolicy(),
      tenantClient().tenantConfig.commissionProposals({ status: 'proposed', limit: 50 }),
      tenantClient().tenantConfig.commissionResolution({ source: source ?? 'direct' }),
    ]);
    policy = p.status === 'fulfilled' ? p.value : null;
    proposals = q.status === 'fulfilled' ? q.value.items : [];
    example = x.status === 'fulfilled' ? x.value : null;
  }
  const scheduled = await (state ? Promise.resolve([] as CommissionRuleProposal[]) : tenantClient().tenantConfig.commissionProposals({ status: 'confirmed', limit: 50 }).then((r) => r.items).catch(() => []));
  const tenantRules = rules.filter((r) => r.scope === 'tenant');
  const rateCell = (r: CommissionRule) => `${t.t('swa.com.bps', { n: String(r.rateBps) })} (${bpsPercent(r.rateBps)})${r.fixedMinor !== '0' ? ` + ${money(r.fixedMinor)}` : ''}`;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swa.com.title')}><span>{t.t('swa.money')}</span> / <span aria-current="page">{t.t('swa.com.title')}</span></nav>
      <div className="kv-page-head">
        <h1>{t.t('swa.com.title')}</h1>
        {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
        <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
        {canManage && !state && <Link href={`${COMMISSION_HREF}/propose`} className="kv-btn kv-btn--primary">{t.t('swa.com.propose')}</Link>}
      </div>
      <p className="kv-field__hint">{t.t('swa.com.subtitle')}</p>
      {share != null && <p className="kv-card kv-card--notice" role="note">{t.t('swa.com.planShare', { n: String(share), pct: bpsPercent(share) })}</p>}
      {!canManage && !state && <p className="kv-notice" role="note">{t.t('swa.com.state.locked')}</p>}

      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swa.com.state.${state}.title`)}</strong><p>{t.t(`swa.com.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={COMMISSION_HREF} className="kv-btn--link">{t.t('swa.retry')}</Link></p>}
        </div>
      ) : (
        <>
          {tenantRules.length === 0 && <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swa.com.state.platformOnly.title')}</strong><p>{t.t('swa.com.state.platformOnly.body')}</p></div>}
          <nav className="kv-tabs" aria-label={t.t('swa.com.view')}>
            <a href={COMMISSION_HREF} className={`kv-tab${!history ? ' kv-tab--active' : ''}`} aria-current={!history ? 'page' : undefined}>{t.t('swa.com.inForce')}</a>
            <a href={`${COMMISSION_HREF}?history=1`} className={`kv-tab${history ? ' kv-tab--active' : ''}`} aria-current={history ? 'page' : undefined}>{t.t('swa.com.history')}</a>
          </nav>
          <DataTable
            rows={rules}
            empty={t.t('swa.com.empty')}
            columns={[
              { header: t.t('swa.com.col.scope'), cell: (r) => <span className="kv-badge">{t.t(`swa.com.scope.${r.scope}`)}</span> },
              { header: t.t('swa.com.col.source'), cell: (r) => (r.source ? t.t(`swa.com.source.${r.source}`) : t.t('swa.com.source.all')) },
              { header: t.t('swa.com.col.rate'), cell: rateCell },
              { header: t.t('swa.com.col.cap'), cell: (r) => money(r.capMinor) },
              { header: t.t('swa.com.col.chargedTo'), cell: (r) => t.t(`swa.com.charged.${r.chargedTo}`) },
              { header: t.t('swa.com.col.effective'), cell: (r) => `${day(r.effectiveFrom)} → ${r.effectiveTo ? day(r.effectiveTo) : ''}` },
              { header: t.t('swa.com.col.priority'), cell: (r) => String(r.priority) },
              { header: t.t('swa.com.col.share'), cell: (r) => t.t(r.scope === 'tenant' ? 'swa.com.shareByPlan' : 'swa.com.sharePlatform', { n: String(r.platformShareBps) }) },
              { header: t.t('swa.com.col.status'), cell: (r) => t.t(`swa.com.status.${r.status ?? (r.isActive ? 'in_force' : 'inactive')}`) },
              { header: '', cell: (r) => (canManage && r.scope === 'tenant' && r.isActive && !r.deactivationProposalId
                ? <Link href={`${COMMISSION_HREF}/act?act=deactivate&id=${r.id}`} className="kv-btn--link">{t.t('swa.com.deactivate')}</Link>
                : <span className="kv-detail__muted">{r.scope === 'platform' ? t.t('swa.com.platformReadOnly') : t.t('common.dash')}</span>) },
            ]}
          />
          <p className="kv-field__hint">{t.t('swa.com.showing', { n: String(rules.length) })}</p>

          <h2>{t.t('swa.com.pending')}</h2>
          {proposals.length === 0 ? <p className="kv-field__hint">{t.t('swa.com.noPending')}</p> : proposals.map((p) => (
            <div key={p.id} className="kv-card">
              <p><strong>{t.t(`swa.com.kind.${p.kind}`)}</strong> · {p.rule ? rateLabel(t, p) : t.t('swa.com.endsRule', { id: (p.targetRuleId ?? '').slice(0, 8) })} · {t.t('swa.com.from', { date: day(p.effectiveFrom) })}</p>
              <p className="kv-detail__muted">{p.reason}</p>
              <p className="kv-detail__muted">{t.t('swa.com.expires', { at: formatDate(p.expiresAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
              {canManage && (
                <p>
                  {p.canConfirm ? <Link href={`${COMMISSION_HREF}/act?act=confirm&id=${p.id}`} className="kv-btn kv-btn--sm">{t.t('swa.com.confirm')}</Link> : <span className="kv-notice">{t.t('swa.com.youProposed')}</span>}{' '}
                  {p.canRefuse && <Link href={`${COMMISSION_HREF}/act?act=refuse&id=${p.id}`} className="kv-btn--link">{t.t(p.isMine ? 'swa.com.withdraw' : 'swa.com.refuse')}</Link>}
                </p>
              )}
            </div>
          ))}
          {scheduled.length > 0 && (
            <>
              <h2>{t.t('swa.com.scheduled')}</h2>
              <ul>{scheduled.map((p) => <li key={p.id}>{t.t(`swa.com.kind.${p.kind}`)} · {t.t('swa.com.from', { date: day(p.effectiveFrom) })} · {t.t('swa.com.noticeSent')}</li>)}</ul>
            </>
          )}

          <div className="kv-card">
            <h2>{t.t('swa.com.example.title')}</h2>
            <form method="get" action={COMMISSION_HREF} className="kv-inline-form">
              <label className="kv-field" htmlFor="ex-src"><span>{t.t('swa.com.col.source')}</span>
                <select id="ex-src" name="source" className="kv-select" defaultValue={source ?? 'direct'}>{COMMISSION_SOURCES.map((s) => <option key={s} value={s}>{t.t(`swa.com.source.${s}`)}</option>)}</select></label>
              <button type="submit" className="kv-btn--link">{t.t('swa.com.example.ask')}</button>
            </form>
            {example?.winner ? (
              <ol>
                <li>{t.t('swa.com.example.facts', { source: t.t(`swa.com.source.${example.facts.source ?? 'all'}`), date: day(example.onDate) })}</li>
                <li>{t.t('swa.com.example.winner', { scope: t.t(`swa.com.scope.${example.winner.scope}`), rate: bpsPercent(example.winner.rateBps), priority: String(example.winner.priority), charged: t.t(`swa.com.charged.${example.winner.chargedTo}`) })}</li>
                <li>{t.t('swa.com.example.frozen')}</li>
              </ol>
            ) : <p className="kv-field__hint">{t.t('swa.com.example.none')}</p>}
          </div>
          <div className="kv-card">
            <h2>{t.t('swa.com.changing.title')}</h2>
            <p>{t.t('swa.com.changing.body', { date: policy ? day(policy.earliestEffectiveFrom) : '—' })}</p>
            <p className="kv-field__hint">{t.t('swa.com.changing.recorded')}</p>
          </div>
        </>
      )}
    </section>
  );
}

function rateLabel(t: ReturnType<typeof getTranslator>, p: CommissionRuleProposal): string {
  const r = p.rule!;
  return `${t.t('swa.com.bps', { n: String(r.rateBps ?? 0) })} (${bpsPercent(r.rateBps ?? 0)}) · ${t.t(`swa.com.charged.${r.chargedTo ?? 'seller'}`)} · ${r.source ? t.t(`swa.com.source.${r.source}`) : t.t('swa.com.source.all')}`;
}
