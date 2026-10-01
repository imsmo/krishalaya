// apps/web-tenant/src/app/auditor/compliance-pack/page.tsx · W437 · THE COMPLIANCE PACK, AS FACTS THAT EXIST (PC-56 TENANT-9c).
//
// The canon's pack is generated at quarter-close, signed by the auditor (the "checker"), immutable, and downloaded as a
// watermarked PDF with a signed manifest. None of that exists: no pack table, no attestation record, no signing key
// (founder-physical), no PDF, no watermark — and *"Sign & attest"* is refused by name. What this page shows is computed ON
// READ for the current fiscal QUARTER of the cooperative's DECLARED year (or the bounded window): its own GST invoices and
// credit notes (IRN counted, not assumed; NOT tied to the shared gst_payable account), its scheme applications by status
// ("e-KYC-blocked" refused), its members' consent and data-subject-request counts (ADMIN-5's planes, read), and the ledger
// attestation as the funnel can state it (zero-sum, the cooperative's own chains; platform chains unverifiable). Each
// section downloads as ITS OWN file through the export chain — one CSV per section, every receipt unsigned.
import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { AuditorCompliancePack } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import {
  AUDITOR_HREF, PACK_HREF, PACK_SECTIONS, PAGE_REFUSALS, chainKey, newExportHref, purposeKey, realmState, realmStateKey, refusedKey,
  sectionKey, windowFilters, windowRefusalKey, type RealmState,
} from '../../../features/auditor/realm';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auditor.pack.title'), robots: { index: false, follow: false } };
}

export default async function CompliancePackPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!env.featureAuditor) notFound();
  await requireSession(PACK_HREF);
  const t = getTranslator();
  const lang = getLang();
  const f = windowFilters(searchParams);
  let p: AuditorCompliancePack | null = null; let state: RealmState | null = null; let wcode: unknown = null;
  try { p = await tenantClient().auditor.compliancePack({ from: f.from, to: f.to }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = realmState(err?.code, err?.status); wcode = (err?.details as { code?: unknown } | undefined)?.code; }
  const money = (minor: string) => formatMoneyMinor(minor, p?.clock.currency ?? 'XXX', lang);
  const n = (x: number) => formatNumber(x, lang);

  return (
    <section>
      <nav aria-label={t.t('auditor.breadcrumb')} className="kv-field__hint"><Link href={AUDITOR_HREF}>{t.t('auditor.title')}</Link>{' / '}{t.t('auditor.pack.title')}</nav>
      <h1>{t.t('auditor.pack.title')}</h1>
      <div className="kv-card kv-card--notice" role="note"><p>{t.t('auditor.pack.banner')}</p></div>
      <p><Link href={AUDITOR_HREF} className="kv-btn kv-btn--secondary">{t.t('auditor.backOverview')}</Link></p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(realmStateKey(state))}</p>
          {state === 'window' && <p className="kv-field__hint">{t.t(windowRefusalKey(wcode))}</p>}
          {state === 'restricted' && <p className="kv-field__hint">{t.t('auditor.pack.restricted')}</p>}
          {state === 'error' && <p className="kv-field__hint">{t.t('auditor.pack.error')} <Link href={PACK_HREF} className="kv-btn--link">{t.t('auditor.reload')}</Link></p>}
        </div>
      )}

      {p && (
        <>
          <div className="kv-grid kv-grid--tiles">
            <div className="kv-card"><h2 className="kv-section-title">{t.t('auditor.pack.tile.period')}</h2>
              <p><strong>{p.quarter ? t.t('auditor.pack.quarter', { q: n(p.quarter.q), label: p.clock.fiscalYear.label ?? '' }) : t.t('auditor.fy.notDeclared')}</strong></p>
              <p className="kv-field__hint">{p.window.from} – {p.window.to} · {t.t('auditor.window.bound', { days: n(p.window.days), max: n(p.window.maxDays), from: p.window.from, to: p.window.to })}</p></div>
            <div className="kv-card"><h2 className="kv-section-title">{t.t('auditor.pack.tile.composition')}</h2>
              <p><strong>{n(PACK_SECTIONS.length)}</strong></p>
              <p className="kv-field__hint">{PACK_SECTIONS.map((s) => t.t(sectionKey(s))).join(' · ')}</p></div>
            <div className="kv-card"><h2 className="kv-section-title">{t.t('auditor.pack.tile.attestation')}</h2>
              <p><span className="kv-badge kv-badge--muted">{t.t('auditor.pack.unsigned')}</span></p>
              <p className="kv-field__hint">{t.t(refusedKey('signAttest'))}</p></div>
            <div className="kv-card"><h2 className="kv-section-title">{t.t('auditor.tile.logged')}</h2>
              <p>{t.t(purposeKey(p.logged.purpose))} · <code>{p.logged.readId}</code></p></div>
          </div>

          <form method="get" className="kv-form kv-form--grid" aria-label={t.t('auditor.window.label')}>
            <label className="kv-label">{t.t('auditor.window.from')}<input className="kv-input" name="from" type="date" defaultValue={f.from ?? p.window.from} /></label>
            <label className="kv-label">{t.t('auditor.window.to')}<input className="kv-input" name="to" type="date" defaultValue={f.to ?? p.window.to} /></label>
            <span className="kv-actions"><button type="submit" className="kv-btn kv-btn--sm">{t.t('auditor.window.apply')}</button></span>
          </form>

          {/* (a) GST — the cooperative's own documents */}
          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.section.gst')}</h2>
            <dl className="kv-dl">
              <dt>{t.t('auditor.pack.gst.invoices')}</dt><dd>{n(p.sections.gst.invoices)}</dd>
              <dt>{t.t('auditor.pack.gst.taxable')}</dt><dd>{money(p.sections.gst.taxableMinor)}</dd>
              {p.sections.gst.bySupplyType.map((b) => (<Fragment key={b.supplyType}><dt>{t.t(`auditor.pack.gst.supply.${['intra', 'inter'].includes(b.supplyType) ? b.supplyType : 'unknown'}`)}</dt><dd>{money(b.taxMinor)} <span className="kv-field__hint">({n(b.invoices)})</span></dd></Fragment>))}
              <dt>{t.t('auditor.pack.gst.tax')}</dt><dd>{money(p.sections.gst.taxMinor)}</dd>
              <dt>{t.t('auditor.pack.gst.total')}</dt><dd>{money(p.sections.gst.totalMinor)}</dd>
              <dt>{t.t('auditor.pack.gst.creditNotes')}</dt><dd>{n(p.sections.gst.creditNotes)} · {money(p.sections.gst.creditNoteTotalMinor)}</dd>
              <dt>{t.t('auditor.pack.gst.irn')}</dt><dd>{n(p.sections.gst.withIrn)} / {n(p.sections.gst.invoices)}</dd>
              <dt>{t.t('auditor.pack.gst.incomplete')}</dt><dd>{n(p.sections.gst.taxBasisIncomplete)}</dd>
            </dl>
            <p className="kv-field__hint">{t.t(refusedKey('irn'))} · {t.t(refusedKey('gstPayableTie'))}</p>
          </div>

          {/* (b) the ledger attestation — what the funnel can state */}
          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.section.ledger')}</h2>
            <p>{t.t('auditor.pack.ledger.txns', { n: n(p.sections.ledger.transactions) })} · {t.t('auditor.integrity.zeroSum', { foot: n(p.sections.ledger.zeroSum.foot), checked: n(p.sections.ledger.zeroSum.checked) })}</p>
            <ul className="kv-list">{p.sections.ledger.ownAccounts.map((a) => <li key={a.accountCode}>{t.t(chainKey(a.chain), { account: a.accountCode, n: n(a.entryCount) })} · {t.t(a.balanceEqualsSum ? 'auditor.balance.equal' : 'auditor.balance.drift', { account: a.accountCode })}</li>)}</ul>
            <p className="kv-field__hint">{t.t('auditor.integrity.shared')}</p>
          </div>

          {/* (c) schemes */}
          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.section.schemes')}</h2>
            <p>{t.t('auditor.pack.schemes.total', { n: n(p.sections.schemes.applications) })}</p>
            <ul className="kv-list">{p.sections.schemes.byStatus.map((s) => <li key={s.status}><code className="kv-code kv-code--inline">{s.status}</code> · {n(s.n)}</li>)}</ul>
            <p className="kv-field__hint">{t.t(refusedKey('ekycBlocked'))}</p>
          </div>

          {/* (d) privacy — ADMIN-5's planes, read for this cooperative's members, counts only */}
          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.section.privacy')}</h2>
            <p>{t.t('auditor.pack.privacy.members', { n: n(p.sections.privacy.members) })}</p>
            <table className="kv-table">
              <thead><tr><th scope="col">{t.t('auditor.pack.privacy.purpose')}</th><th scope="col">{t.t('auditor.pack.privacy.granted')}</th><th scope="col">{t.t('auditor.pack.privacy.withdrawn')}</th><th scope="col">{t.t('auditor.pack.privacy.never')}</th></tr></thead>
              <tbody>{p.sections.privacy.consents.map((c) => <tr key={c.purposeCode}><td><code className="kv-code kv-code--inline">{c.purposeCode}</code></td><td>{n(c.granted)}</td><td>{n(c.withdrawn)}</td><td>{n(c.never)}</td></tr>)}</tbody>
            </table>
            {p.sections.privacy.requests.length === 0 ? <p className="kv-field__hint">{t.t('auditor.pack.privacy.noRequests')}</p>
              : <ul className="kv-list">{p.sections.privacy.requests.map((r) => <li key={`${r.requestType}-${r.status}`}><code className="kv-code kv-code--inline">{r.requestType}</code> · {r.status} · {n(r.n)}</li>)}</ul>}
            <p className="kv-field__hint">{t.t('auditor.pack.privacy.owner')}</p>
          </div>

          {/* Download — one file per section, unsigned by name */}
          <div className="kv-card">
            <h2 className="kv-section-title">{t.t('auditor.pack.download.title')}</h2>
            <p>{t.t('auditor.pack.download.body')}</p>
            <ul className="kv-list">{PACK_SECTIONS.map((s) => <li key={s}><Link href={newExportHref('compliance.pack', { section: s, from: p!.window.from, to: p!.window.to })} className="kv-btn--link">{t.t('auditor.pack.download.section', { section: t.t(sectionKey(s)) })}</Link></li>)}</ul>
            <p className="kv-field__hint">{p.unsignedNote}</p>
            {PAGE_REFUSALS.pack.filter((r) => !['irn', 'gstPayableTie', 'ekycBlocked', 'signAttest'].includes(r)).map((r) => <p key={r} className="kv-field__hint">{t.t(refusedKey(r))}</p>)}
          </div>
        </>
      )}
    </section>
  );
}
