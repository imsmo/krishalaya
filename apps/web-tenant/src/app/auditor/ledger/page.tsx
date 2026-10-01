// apps/web-tenant/src/app/auditor/ledger/page.tsx · W436 · THE LEDGER DRILL-DOWN, through the tenant funnel (PC-56 TENANT-9c).
//
// Every transaction of THIS cooperative in the window (≤ 92 days, its own days), newest first, keyset (*Next page*), each with
// every leg attributed to it: account, Dr/Cr, amount, running balance, and the printed recompute (−a + b + c = Σ). For a leg
// on an account the cooperative OWNS: the balance after it and its HASH LINK — recomputed by the API with the writer's own
// formula and compared with the entry before it — as a verdict. For a leg on a PLATFORM account (escrow, fees …): the
// amount only; its link is WITHHELD by name (shared and striped across cooperatives — ADMIN-6). A member's wallet leg prints
// a masked identifier, never a name. A transaction with a leg not attributed to this cooperative says it cannot be footed
// here. *"This view, logged"* is the read-log row this page wrote. "Widen range" (decor) → the window form; the wider pull is
// the export (W201). Server component; no client JS.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { AuditorLedgerPage } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import {
  AUDITOR_HREF, EXPORTS_HREF, LEDGER_HREF, PAGE_REFUSALS, footKey, hashLinkKey, hashLinkTone, ledgerHref, legKindKey, newExportHref,
  purposeKey, realmState, realmStateKey, refusedKey, shortHash, sideKey, signedTerms, windowFilters, windowRefusalKey, type RealmState,
} from '../../../features/auditor/realm';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auditor.ledger.title'), robots: { index: false, follow: false } };
}

export default async function AuditorLedgerPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!env.featureAuditor) notFound();
  await requireSession(LEDGER_HREF);
  const t = getTranslator();
  const lang = getLang();
  const f = windowFilters(searchParams);
  let page: AuditorLedgerPage | null = null; let state: RealmState | null = null; let wcode: unknown = null;
  try { page = await tenantClient().auditor.ledger({ from: f.from, to: f.to, cursor: f.cursor, txnType: f.txnType, limit: 20 }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = realmState(err?.code, err?.status); wcode = (err?.details as { code?: unknown } | undefined)?.code; }
  const zone = page?.clock.zone;
  const when = (iso: string) => formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', ...(zone ? { timeZone: zone } : {}) });
  const money = (minor: string, ccy?: string | null) => formatMoneyMinor(minor, ccy ?? page?.clock.currency ?? 'XXX', lang);

  return (
    <section>
      <nav aria-label={t.t('auditor.breadcrumb')} className="kv-field__hint"><Link href={AUDITOR_HREF}>{t.t('auditor.title')}</Link>{' / '}{t.t('auditor.ledger.title')}</nav>
      <h1>{t.t('auditor.ledger.title')}</h1>
      <div className="kv-card kv-card--notice" role="note"><p>{t.t('auditor.ledger.banner')}</p></div>
      <p>
        <Link href={AUDITOR_HREF} className="kv-btn kv-btn--secondary">{t.t('auditor.backOverview')}</Link>{' '}
        <Link href={EXPORTS_HREF} className="kv-btn kv-btn--secondary">{t.t('auditor.link.exports')}</Link>
      </p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(realmStateKey(state))}</p>
          {state === 'window' && <p className="kv-field__hint">{t.t(windowRefusalKey(wcode))}</p>}
          {state === 'restricted' && <p className="kv-field__hint">{t.t('auditor.ledger.restricted')}</p>}
          {state === 'error' && <p className="kv-field__hint">{t.t('auditor.state.error.safe')} <Link href={ledgerHref(f)} className="kv-btn--link">{t.t('auditor.reload')}</Link></p>}
        </div>
      )}

      <form method="get" className="kv-form kv-form--grid" aria-label={t.t('auditor.window.label')}>
        <label className="kv-label">{t.t('auditor.window.from')}<input className="kv-input" name="from" type="date" defaultValue={f.from ?? page?.window.from ?? ''} /></label>
        <label className="kv-label">{t.t('auditor.window.to')}<input className="kv-input" name="to" type="date" defaultValue={f.to ?? page?.window.to ?? ''} /></label>
        <label className="kv-label">{t.t('auditor.ledger.type')}<input className="kv-input" name="txnType" defaultValue={f.txnType ?? ''} maxLength={60} placeholder="payout" /></label>
        <span className="kv-actions"><button type="submit" className="kv-btn kv-btn--sm">{t.t('auditor.window.apply')}</button> <Link href={LEDGER_HREF} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('aud.filter.clear')}</Link></span>
      </form>

      {page && (
        <>
          <div className="kv-grid kv-grid--tiles">
            <div className="kv-card"><h2 className="kv-section-title">{t.t('auditor.ledger.tile.drilled')}</h2>
              <p><strong>{formatNumber(page.items.length, lang)}</strong></p>
              <p className="kv-field__hint">{t.t('auditor.ledger.tile.legs', { n: formatNumber(page.items.reduce((a, x) => a + x.legs.length, 0), lang) })}</p></div>
            <div className="kv-card"><h2 className="kv-section-title">{t.t('auditor.ledger.tile.period')}</h2>
              <p><strong>{page.window.from} – {page.window.to}</strong></p>
              <p className="kv-field__hint">{t.t('auditor.window.bound', { days: formatNumber(page.window.days, lang), max: formatNumber(page.window.maxDays, lang), from: page.window.from, to: page.window.to })} · {page.clock.zone}</p></div>
            <div className="kv-card"><h2 className="kv-section-title">{t.t('auditor.ledger.tile.zeroSum')}</h2>
              <p>{t.t('auditor.integrity.zeroSum', { foot: formatNumber(page.integrity.zeroSum.foot, lang), checked: formatNumber(page.integrity.zeroSum.checked, lang) })}</p>
              <p className="kv-field__hint">{t.t('auditor.ledger.tile.links', { linked: formatNumber(page.integrity.ownLinks.linked, lang), checked: formatNumber(page.integrity.ownLinks.checked, lang), withheld: formatNumber(page.integrity.withheld.sharedStripe + page.integrity.withheld.memberWallet + page.integrity.withheld.otherTenant, lang) })}</p></div>
            <div className="kv-card"><h2 className="kv-section-title">{t.t('auditor.tile.logged')}</h2>
              <p>{t.t(purposeKey(page.logged.purpose))} · <code>{page.logged.readId}</code></p></div>
          </div>

          {page.items.length === 0 && <div className="kv-card kv-card--notice" role="status"><p>{t.t('auditor.ledger.empty')}</p><p className="kv-field__hint">{t.t('auditor.ledger.widen')}</p></div>}

          {page.items.map((x) => (
            <article key={x.txnId} className="kv-card" aria-labelledby={`tx-${x.txnId}`}>
              <h2 id={`tx-${x.txnId}`} className="kv-section-title">
                <code className="kv-code kv-code--inline">{x.txnId.slice(0, 8)}…{x.txnId.slice(-4)}</code> · {x.txnType ?? t.t('common.dash')} · {when(x.createdAt)}
                {' '}<span className={`kv-badge kv-badge--${x.foot.foots ? 'ok' : x.foot.complete ? 'danger' : 'muted'}`}>{t.t(footKey(x.foot))}</span>
              </h2>
              <table className="kv-table">
                <thead><tr>
                  <th scope="col">{t.t('auditor.leg.n')}</th><th scope="col">{t.t('auditor.leg.account')}</th><th scope="col">{t.t('auditor.leg.drcr')}</th>
                  <th scope="col">{t.t('auditor.leg.amount')}</th><th scope="col">{t.t('auditor.leg.running')}</th><th scope="col">{t.t('auditor.leg.balanceAfter')}</th><th scope="col">{t.t('auditor.leg.link')}</th>
                </tr></thead>
                <tbody>
                  {x.legs.map((l) => (
                    <tr key={l.entryId}>
                      <td>{formatNumber(l.n, lang)}</td>
                      <td>{l.accountLabel} <span className="kv-field__hint">({t.t(legKindKey(l.kind))})</span></td>
                      <td>{t.t(sideKey(l.side))}</td>
                      <td>{money(l.amountMinor.replace(/^-/, ''), x.currencyCode)}</td>
                      <td>{money(l.runningMinor, x.currencyCode)}</td>
                      <td>{l.balanceAfterMinor === null ? <span className="kv-field__hint">{t.t('auditor.leg.balanceWithheld')}</span> : money(l.balanceAfterMinor, x.currencyCode)}</td>
                      <td><span className={`kv-badge kv-badge--${hashLinkTone(l.hashLink) === 'ok' ? 'ok' : hashLinkTone(l.hashLink) === 'danger' ? 'danger' : 'muted'}`}>{t.t(hashLinkKey(l.hashLink))}</span>
                        {l.hashLink.kind !== 'withheld' && <> <code className="kv-code kv-code--inline">{shortHash(l.hashLink.entryHash)}</code></>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="kv-field__hint">
                {t.t('auditor.leg.recompute')}{' '}
                <span className="kv-mono">{signedTerms(x.foot.terms).map((s, i) => <span key={i}>{s.first ? (s.sign === '−' ? '−' : '') : ` ${s.sign} `}{money(s.absMinor, x.currencyCode)}</span>)} = {money(x.foot.sumMinor, x.currencyCode)}</span>
                {' · '}{t.t('auditor.explorer.legs', { n: formatNumber(x.foot.legsVisible, lang), total: formatNumber(x.foot.legsTotal, lang) })}
                {x.referenceType ? ` · ${x.referenceType}${x.referenceId ? ` ${x.referenceId.slice(0, 8)}` : ''}` : ''}
              </p>
            </article>
          ))}
          {page.nextCursor && <p><Link href={ledgerHref(f, page.nextCursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('aud.list.next')}</Link></p>}

          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.ledger.export.title')}</h2>
            <p>{t.t('auditor.ledger.export.body')}</p>
            <p><Link href={newExportHref('ledger.entries', { from: page.window.from, to: page.window.to })} className="kv-btn kv-btn--secondary">{t.t('auditor.ledger.export.button')}</Link></p>
            {PAGE_REFUSALS.ledger.map((r) => <p key={r} className="kv-field__hint">{t.t(refusedKey(r))}</p>)}
          </div>
        </>
      )}
    </section>
  );
}
