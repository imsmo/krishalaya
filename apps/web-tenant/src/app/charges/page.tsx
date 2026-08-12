// apps/web-tenant/src/app/charges/page.tsx · W150, charges & taxes (PC-56 TENANT-3c-2).
// Server-first, requireSession-gated, noindex, all copy via i18n. Two tables: the tenant's own fee rows (writable
// through a PROPOSAL a second admin signs) and the statutory rules (READ-ONLY by design — there is no write control
// on this page for them, and none in the API either).
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • which row is IN FORCE today, computed with the resolver's own precedence — a console that disagreed with the
//     engine about today's price would be worse than no console;
//   • which surface each charge code prices, and 'read by no code' where nothing resolves it;
//   • for the tax table, WHICH code path reads each recorded rule — and that no commodity GST rate is recorded at
//     all, which is exactly why W151 counts invoices whose goods line has no rate.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { tenantHasPerm } from '../../lib/auth';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import {
  OFFERED_CALC_METHODS, amountView, canApplyProposal, canSignProposal, commodityRatesRecorded,
  earliestEffectiveFrom, proposeBlockedBy, readerKey, rowState, surfaceKey,
} from '../../features/charges/console';
import { proposeChargeAction, decideChargeAction, applyChargeAction } from './actions';
import type { ChargeOverview } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('chg.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['proposed', 'approved', 'rejected', 'applied']);
const ERR = new Set(['note', 'noteShort', 'effective', 'effectivePast', 'effectiveBefore', 'config', 'method',
  'duplicate', 'decided', 'checkerIsMaker', 'noOverride', 'forbidden', 'notFound', 'generic']);

export default async function ChargesPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/charges');
  const t = getTranslator();
  const lang = getLang();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const canManage = tenantHasPerm('tenant.settings');

  let data: ChargeOverview | null = null;
  let failed = false;
  try { data = await tenantClient().payments.charges.overview(); } catch { failed = true; }
  let meId: string | null = null;
  try { meId = (await tenantClient().auth.me()).id; } catch { meId = null; }

  const money = (minor: string | null) => (minor ? formatMoneyMinor(minor, 'INR', lang) : t.t('common.dash'));
  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const amountText = (calcMethod: string, config: Record<string, unknown>): string => {
    const v = amountView(calcMethod, config);
    if (v.kind === 'flat' || v.kind === 'per_unit') return money(v.feeMinor);
    if (v.kind === 'percent') {
      const base = t.t('chg.amountPercent', { pct: (v.bps / 100).toFixed(2) });
      const min = v.minMinor ? t.t('chg.amountMin', { amount: money(v.minMinor) }) : '';
      const max = v.maxMinor ? t.t('chg.amountMax', { amount: money(v.maxMinor) }) : '';
      return `${base}${min}${max}`;
    }
    if (v.kind === 'slab') {
      return v.bands.map((b) => (b.uptoMinor
        ? t.t('chg.amountBand', { upto: money(b.uptoMinor), fee: money(b.feeMinor) })
        : t.t('chg.amountBandRest', { fee: money(b.feeMinor) }))).join(' · ');
    }
    return t.t('chg.amountUnknown');
  };

  const commodityRates = data ? commodityRatesRecorded(data.taxRules) : 0;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('chg.title')}</h1>
        <Link href="/invoices" className="kv-btn--link">{t.t('chg.invoicesLink')}</Link>
      </div>
      <p className="kv-field__hint">{t.t('chg.sub')}</p>
      <p className="kv-field__hint">{t.t('chg.auditNote')}</p>

      {!canManage && <p className="kv-notice" role="note">{t.t('chg.needsPerm')}</p>}
      {okKey && <p className="kv-success" role="status">{t.t(`chg.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`chg.error.${errKey}`)}</p>}
      {failed && <p className="kv-error" role="alert">{t.t('chg.loadError')}</p>}

      <h2 className="kv-section-title">{t.t('chg.chargesTitle')}</h2>
      {data && (
        <table className="kv-table">
          <thead>
            <tr>
              <th>{t.t('chg.colCharge')}</th><th>{t.t('chg.colApplies')}</th><th>{t.t('chg.colAmount')}</th>
              <th>{t.t('chg.colEffective')}</th><th>{t.t('chg.colStatus')}</th><th />
            </tr>
          </thead>
          <tbody>
            {data.charges.map((c) => {
              const state = rowState(c, today);
              const blocked = proposeBlockedBy(c, { canManage });
              return (
                <tr key={c.id}>
                  <td>
                    {/* A platform row has no label by design — printing the CODE is honest; an invented name would
                        read as the tenant's own (0141 DEFECT 5). */}
                    {c.label ?? <span className="kv-mono">{c.chargeCode}</span>}
                    {!c.computable && <span className="kv-error-text"> {t.t('chg.notComputable')}</span>}
                  </td>
                  <td>{t.t(`chg.surface.${surfaceKey(c.surface)}`)}</td>
                  <td>{amountText(c.calcMethod, c.config)}</td>
                  <td>
                    {formatDate(c.effectiveFrom, lang)} →{c.effectiveTo ? ` ${formatDate(c.effectiveTo, lang)}` : ''}
                  </td>
                  <td><span className="kv-badge">{t.t(`chg.state.${state}`)}</span></td>
                  <td>{blocked ? <span className="kv-detail__muted">{t.t(`chg.blocked.${blocked}`)}</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {canManage && (
        <form action={proposeChargeAction} className="kv-form kv-card">
          <h2 className="kv-card__title">{t.t('chg.proposeTitle')}</h2>
          <label className="kv-field__label" htmlFor="chargeCode">{t.t('chg.fieldCode')}</label>
          <input id="chargeCode" name="chargeCode" className="kv-input" pattern="[a-z][a-z0-9_]*" required />
          <p className="kv-field__hint">{t.t('chg.fieldCodeHint')}</p>
          <label className="kv-field__label" htmlFor="label">{t.t('chg.fieldLabel')}</label>
          <input id="label" name="label" className="kv-input" maxLength={120} />
          <label className="kv-field__label" htmlFor="action">{t.t('chg.fieldAction')}</label>
          <select id="action" name="action" className="kv-select" defaultValue="change">
            <option value="add">{t.t('chg.action.add')}</option>
            <option value="change">{t.t('chg.action.change')}</option>
            <option value="end">{t.t('chg.action.end')}</option>
          </select>
          <label className="kv-field__label" htmlFor="calcMethod">{t.t('chg.fieldMethod')}</label>
          {/* per_km is NOT offered: the column accepts it and the pricing engine throws on it. */}
          <select id="calcMethod" name="calcMethod" className="kv-select" defaultValue="flat">
            {OFFERED_CALC_METHODS.map((m) => <option key={m} value={m}>{t.t(`chg.method.${m}`)}</option>)}
          </select>
          <label className="kv-field__label" htmlFor="config">{t.t('chg.fieldConfig')}</label>
          <textarea id="config" name="config" className="kv-textarea" rows={3} placeholder='{"fee_minor": 12000}' />
          <p className="kv-field__hint">{t.t('chg.fieldConfigHint')}</p>
          <label className="kv-field__label" htmlFor="effectiveFrom">{t.t('chg.fieldEffective')}</label>
          <input id="effectiveFrom" name="effectiveFrom" type="date" className="kv-input" min={earliestEffectiveFrom(now)} defaultValue={earliestEffectiveFrom(now)} required />
          <p className="kv-field__hint">{t.t('chg.fieldEffectiveHint')}</p>
          <label className="kv-field__label" htmlFor="note">{t.t('chg.fieldNote')}</label>
          <textarea id="note" name="note" className="kv-textarea" rows={2} minLength={20} maxLength={2000} required />
          <p className="kv-field__hint">{t.t('chg.fieldNoteHint')}</p>
          <button type="submit" className="kv-btn">{t.t('chg.proposeCta')}</button>
        </form>
      )}

      {data && data.proposals.length > 0 && (
        <>
          <h2 className="kv-section-title">{t.t('chg.proposalsTitle')}</h2>
          <ul className="kv-thread">
            {data.proposals.map((p) => (
              <li key={p.id} className="kv-thread__item">
                <span className="kv-badge">{t.t(`chg.pstatus.${p.status}`)}</span>
                <span className="kv-mono">{p.label ?? p.chargeCode}</span>
                <span>{t.t(`chg.action.${p.action}`)}</span>
                <span className="kv-muted">{t.t('chg.fromDate', { date: formatDate(p.effectiveFrom, lang) })}</span>
                <p className="kv-review__body">{p.proposalNote}</p>
                {p.decisionNote && <p className="kv-review__body">{p.decisionNote}</p>}
                {canSignProposal(p, meId, canManage) ? (
                  <form action={decideChargeAction} className="kv-inline-form">
                    <input type="hidden" name="proposalId" value={p.id} />
                    <label className="kv-label" htmlFor={`dn-${p.id}`}>{t.t('chg.decisionNote')}</label>
                    <textarea id={`dn-${p.id}`} name="note" className="kv-input" rows={2} maxLength={2000} />
                    <button type="submit" name="decision" value="approved" className="kv-btn kv-btn--sm">{t.t('chg.approveCta')}</button>
                    <button type="submit" name="decision" value="rejected" className="kv-btn kv-btn--sm kv-btn--muted">{t.t('chg.rejectCta')}</button>
                  </form>
                ) : p.status === 'pending' ? (
                  /* The maker sees WHY there is no button instead of a control that would be refused. */
                  <p className="kv-notice" role="note">{t.t(canManage ? 'chg.youProposed' : 'chg.needsPerm')}</p>
                ) : null}
                {canApplyProposal(p, canManage) && (
                  <form action={applyChargeAction} className="kv-inline-form">
                    <input type="hidden" name="proposalId" value={p.id} />
                    <p className="kv-field__hint">{t.t('chg.applyHint')}</p>
                    <button type="submit" className="kv-btn kv-btn--sm">{t.t('chg.applyCta')}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="kv-section-title">{t.t('chg.taxTitle')}</h2>
      <p className="kv-notice" role="note">{t.t('chg.taxReadOnly')}</p>
      {data && (
        <>
          <table className="kv-table">
            <thead>
              <tr>
                <th>{t.t('chg.colRule')}</th><th>{t.t('chg.colRate')}</th><th>{t.t('chg.colAuthority')}</th>
                <th>{t.t('chg.colReadBy')}</th><th>{t.t('chg.colEffective')}</th>
              </tr>
            </thead>
            <tbody>
              {data.taxRules.map((r) => (
                <tr key={`${r.taxCode}-${r.effectiveFrom}-${r.hsnPrefix ?? 'all'}`}>
                  <td className="kv-mono">{r.taxCode}{r.hsnPrefix ? ` · HSN ${r.hsnPrefix}` : ''}</td>
                  <td className="kv-mono">{(r.rateBps / 100).toFixed(2)}%</td>
                  {/* 0140 added `legal_ref`. NULL says so — a rate with an invented citation is worse than one with none. */}
                  <td>{r.legalRef ?? <span className="kv-muted">{t.t('chg.authorityNotRecorded')}</span>}</td>
                  <td>{t.t(`chg.readBy.${readerKey(r.readBy)}`)}</td>
                  <td>{formatDate(r.effectiveFrom, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* The link to W151's incomplete-basis counter, said where somebody can act on it. */}
          {commodityRates === 0 && <p className="kv-notice" role="note">{t.t('chg.noCommodityRates')}</p>}
        </>
      )}
    </section>
  );
}
