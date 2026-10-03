// apps/web-tenant/src/app/settings/org/page.tsx · W186 · ORGANISATION SETTINGS — PC-56 TENANT-13b.
//
// The canon's screen, printed as built (founder decision: tenant maker-checker with platform floors, effective next midnight IST with a
// member notice):
//   • the registry table — Key · Type · Platform default · Your value · Effect · risk badge · pending-proposal badge — over the keys a
//     consumer READS (the Effect is the registry's description only there); each row's act is the route the API will take: Save
//     (ordinary, direct), Propose (money / security / trust — a second administrator confirms; from next midnight IST), or none
//     (platform-locked by its floor);
//   • the "defined, not yet wired" list, collapsed, with the honest sentence per key (F-15);
//   • pending proposals with Confirm / Refuse (W2758–W2760) and the floor + "effective <time>" on each;
//   • the Languages panel writes tenant_languages (F-14); "add-on" language pricing is refused by name (no add-on carrier);
//   • "Change discipline" printed from the API's own discipline block; the footnote; the history link per key;
//   • states: all defaults · couldn't load (Retry) · restricted (tenant.settings) · flagged off (`tenancy`) · needs a second
//     administrator · loading (loading.tsx).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { OrgSettingsRegistry } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import {
  ORG_HREF, editHref, historyHref, pageState, parseCodes, proposalHref, refusalKey, riskKey, routeKey, showValue, splitRows,
} from '../../../features/org-settings/org-settings';
import { saveLanguagesAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('os.title'), robots: { index: false, follow: false } };
}

export default async function OrgSettingsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(ORG_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');

  let data: OrgSettingsRegistry | null = null; let state: string | null = null;
  try { data = await tenantClient().orgSettings.registry(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status); }
  const rows = data ? splitRows(data.items) : null;
  const pending = data ? data.items.filter((i) => i.pendingProposal).map((i) => ({ row: i, p: i.pendingProposal! })) : [];
  const langErrors = parseCodes(searchParams.langError);
  const uses = (searchParams.uses ?? '').split(',').map((u) => u.split(':')).filter((u) => u.length === 3);

  return (
    <section>
      <nav aria-label={t.t('os.breadcrumb.label')} className="kv-field__hint">{t.t('os.breadcrumb.settings')} › {t.t('os.title')}</nav>
      <h1>{t.t('os.title')}</h1>
      <p>{t.t('os.lede')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`os.state.${state}.title`)}</strong><p>{t.t(`os.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={ORG_HREF} className="kv-btn--link">{t.t('os.state.retry')}</Link></p>}
        </div>
      )}

      {data && data.admins.count < 2 && (
        <div className="kv-card kv-card--notice" role="note">
          <strong>{t.t('os.secondAdmin.title')}</strong>
          <p>{t.t('os.secondAdmin.body', { n: formatNumber(data.admins.count, lang) })}</p>
        </div>
      )}

      {data && data.counts.overridden === 0 && (
        <div className="kv-card">
          <strong>{t.t('os.empty.title')}</strong>
          <p>{t.t('os.empty.body')}</p>
        </div>
      )}

      {rows && (
        <>
          <table className="kv-table">
            <caption className="kv-field__hint">{t.t('os.table.caption')}</caption>
            <thead><tr>
              <th scope="col">{t.t('os.col.key')}</th><th scope="col">{t.t('os.col.type')}</th><th scope="col">{t.t('os.col.default')}</th>
              <th scope="col">{t.t('os.col.value')}</th><th scope="col">{t.t('os.col.effect')}</th><th scope="col">{t.t('os.col.risk')}</th>
              <th scope="col">{t.t('os.col.act')}</th>
            </tr></thead>
            <tbody>
              {rows.table.map((r) => (
                <tr key={r.key}>
                  <td><code>{r.key}</code><br /><Link href={historyHref(r.key)} className="kv-btn--link">{t.t('os.row.history')}</Link></td>
                  <td>{r.type}</td>
                  <td><code>{showValue(r.platformDefault)}</code></td>
                  <td>
                    <code>{showValue(r.value)}</code> <span className="kv-field__hint">{t.t(r.isDefault ? 'os.row.default' : 'os.row.yours')}</span>
                    {r.outsideFloor && <><br /><span className="kv-error">{t.t('os.row.outsideFloor')}</span></>}
                  </td>
                  <td>{r.effect ?? ''}</td>
                  <td>
                    <span className="kv-badge">{t.t(riskKey(r))}</span>
                    {(r.floor.min !== null || r.floor.max !== null) && (
                      <><br /><span className="kv-field__hint">{t.t(r.floor.locked ? 'os.row.floorLocked' : 'os.row.floor', { min: showValue(r.floor.min), max: showValue(r.floor.max) })}</span></>
                    )}
                    {r.pendingProposal && <><br /><span className="kv-badge kv-badge--warn">{t.t(`os.pending.${r.pendingProposal.status}`, { at: when(r.pendingProposal.effectiveAt ?? r.pendingProposal.expiresAt) })}</span></>}
                  </td>
                  <td>
                    {r.route !== 'none' && !r.pendingProposal
                      ? <Link href={editHref(r.key)} className="kv-btn--link">{t.t(r.route === 'proposal' ? 'os.act.propose' : 'os.act.save')}</Link>
                      : <span className="kv-field__hint">{t.t(r.pendingProposal ? 'os.act.waiting' : routeKey(r.route, r.floor.locked))}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('os.count', { shown: formatNumber(rows.table.length, lang), total: formatNumber(data!.counts.total, lang), overridden: formatNumber(data!.counts.overridden, lang) })}</p>

          <details className="kv-card">
            <summary>{t.t('os.unwired.summary', { n: formatNumber(rows.unwired.length, lang) })}</summary>
            <p>{t.t('os.unwired.lede')}</p>
            <ul className="kv-list">
              {rows.unwired.map((r) => (
                <li key={r.key}><code>{r.key}</code> · {r.type} · <code>{showValue(r.value)}</code> — {t.t(`os.unwired.${r.unwiredReason ?? 'no_consumer'}`)}</li>
              ))}
            </ul>
          </details>
        </>
      )}

      {data && pending.length > 0 && (
        <div className="kv-card">
          <h2>{t.t('os.proposals.title')}</h2>
          <ul className="kv-list">
            {pending.map(({ row, p }) => (
              <li key={p.id}>
                <code>{row.key}</code>: <code>{showValue(p.oldValue)}</code> → <code>{showValue(p.newValue)}</code> · {t.t('os.proposals.by', { name: p.proposedByName ?? t.t('os.proposals.someone'), at: when(p.proposedAt) })}
                <br /><span className="kv-field__hint">{p.status === 'confirmed'
                  ? t.t('os.proposals.confirmed', { name: p.confirmedByName ?? t.t('os.proposals.someone'), at: when(p.effectiveAt) })
                  : t.t('os.proposals.waiting', { at: when(p.expiresAt) })}</span>
                <br /><span className="kv-field__hint">{t.t('os.proposals.reason', { reason: p.reason })}</span>
                {p.status === 'proposed' && (
                  <p>
                    {p.canConfirm ? <Link href={proposalHref(p.id, 'confirm')} className="kv-btn kv-btn--primary">{t.t('os.proposals.confirm')}</Link>
                      : <span className="kv-field__hint">{t.t('os.proposals.youProposed')}</span>}{' · '}
                    <Link href={proposalHref(p.id, 'refuse')} className="kv-btn--link">{t.t(p.youProposed ? 'os.proposals.withdraw' : 'os.proposals.refuse')}</Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && (
        <div className="kv-card" id="languages">
          <h2>{t.t('os.lang.title')}</h2>
          <p>{t.t('os.lang.note')}</p>
          {searchParams.langOk && <p className="kv-success" role="status">{t.t('os.lang.saved')}</p>}
          {langErrors.length > 0 && (
            <div className="kv-error" role="alert">
              <ul className="kv-list">{langErrors.map((c) => <li key={c}>{t.t(refusalKey(c))}</li>)}</ul>
              {uses.length > 0 && <ul className="kv-list">{uses.map(([code, kind, n]) => <li key={`${code}-${kind}`}>{t.t('os.lang.uses', { lang: code, kind: t.t(`os.lang.kind.${kind}`), n })}</li>)}</ul>}
            </div>
          )}
          <form action={saveLanguagesAction} className="kv-form">
            <fieldset className="kv-fieldset">
              <legend>{t.t('os.lang.enabled')}</legend>
              {data.languages.platform.map((l) => (
                <label key={l.code} className="kv-check">
                  <input type="checkbox" name="enabled" value={l.code} defaultChecked={data!.languages.enabled.some((e) => e.code === l.code)} />
                  {l.nameNative} ({l.nameEnglish})
                </label>
              ))}
            </fieldset>
            <fieldset className="kv-fieldset">
              <legend>{t.t('os.lang.primary')}</legend>
              {data.languages.platform.map((l) => (
                <label key={l.code} className="kv-check">
                  <input type="radio" name="primary" value={l.code} defaultChecked={data!.languages.enabled.some((e) => e.code === l.code && e.isDefault)} required />
                  {l.nameNative}
                </label>
              ))}
            </fieldset>
            <label className="kv-field" htmlFor="os-lang-reason"><span>{t.t('os.lang.reason')}</span>
              <input id="os-lang-reason" name="reason" className="kv-input" maxLength={500} /></label>
            <p className="kv-field__hint">{t.t('os.lang.guard')}</p>
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('os.lang.save')}</button>
          </form>
          {data.languages.enabled.length === 0 && <p className="kv-field__hint">{t.t('os.lang.none')}</p>}
          <p className="kv-field__hint">{t.t('os.lang.addOn')}</p>
        </div>
      )}

      {data && (
        <div className="kv-card">
          <h2>{t.t('os.discipline.title')}</h2>
          <p>{t.t('os.discipline.body', { days: formatNumber(data.discipline.proposalTtlDays, lang), min: formatNumber(data.discipline.reasonMin, lang) })}</p>
          <p className="kv-field__hint">{t.t('os.footnote')} · <Link href={historyHref()} className="kv-btn--link">{t.t('os.historyAll')}</Link></p>
        </div>
      )}
    </section>
  );
}
