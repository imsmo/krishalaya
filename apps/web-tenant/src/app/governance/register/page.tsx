// apps/web-tenant/src/app/governance/register/page.tsx · W197 "Cooperative governance — share register" (PC-56 TENANT-1e).
//
// W197's subtitle: "Share register, voting rights, resolutions — the democratic machinery of your FPO, kept as carefully as
// the money. One member, one voice, on the record."
//
// **WHAT THIS PAGE DELIBERATELY DOES NOT OFFER: A WAY TO EDIT THE REGISTER.** W197's own restricted state says "Register edits
// are board + checker", and its allotment panel says shares are allotted "at their first settlement — ₹200 deducted with
// consent". That is a money movement with a consent record behind it, and there is no such path yet (TENANT-1e-Q4). A button
// here would be a control whose promise the code cannot keep, so the panel states the position instead of pretending to it.
//
// Server component. The register is 1,212 rows for the canon's tenant and keyset-paginated, so the cursor lives in the URL —
// which also makes a page of the legal register a link a secretary can send to an auditor.
import type { Metadata } from 'next';
import type { ShareRegisterView } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import {
  bylawRows, eligiblePct, registerCaption, sortRegister, turnoutTile, verdictLabel,
} from '../../../features/governance/register';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('reg.title'), robots: { index: false, follow: false } };
}

export default async function ShareRegisterPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession('/governance/register');
  const t = getTranslator();
  const lang = getLang();

  let view: ShareRegisterView | null = null;
  let failed = false;
  // Degrade-never-die (Law 12): the register failing to load must not take the governance area down, and W197 has a named
  // "Couldn't load register · The register is versioned and safe. Retry." state for exactly this.
  try { view = await tenantClient().memberships.shareRegister(searchParams.cursor); }
  catch { failed = true; }

  const rows = view ? sortRegister(view.rows) : [];
  const turnout = view ? turnoutTile(view.tiles) : null;
  const ePct = view ? eligiblePct(view.tiles) : null;

  return (
    <section>
      <h1>{t.t('reg.title')}</h1>
      <p className="kv-field__hint">{t.t('reg.hint')}</p>

      <nav className="kv-tabs" aria-label={t.t('reg.tabs')}>
        <span className="kv-tab kv-tab--active" aria-current="page">{t.t('reg.tab.register')}</span>
        <a href="/governance" className="kv-tab">{t.t('reg.tab.resolutions')}</a>
      </nav>

      {failed ? (
        <div className="kv-card">
          <p className="kv-error" role="alert">{t.t('reg.loadError')}</p>
          <a href="/governance/register" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('reg.retry')}</a>
        </div>
      ) : !view ? null : view.tiles.members === 0 ? (
        <div className="kv-card">
          <strong>{t.t('reg.empty.title')}</strong>
          <p className="kv-detail__muted">{t.t('reg.empty.body')}</p>
        </div>
      ) : (
        <>
          <div className="kv-stat-grid">
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('reg.tile.shareholders')}</span>
              <strong className="kv-stat__value">{view.tiles.shareholders.toLocaleString(lang)}</strong>
              <span className="kv-stat__hint">
                {t.t('reg.tile.shareholdersHint', { members: view.tiles.members, pending: view.tiles.pendingAllotment })}
              </span>
            </div>
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('reg.tile.capital')}</span>
              <strong className="kv-stat__value">{formatMoneyMinor(view.tiles.shareCapitalMinor, 'INR', lang)}</strong>
              <span className="kv-stat__hint">
                {/* The face-value clause appears only when the register divides exactly — see features/governance/register.ts. */}
                {view.tiles.faceValueMinor
                  ? t.t('reg.tile.capitalHint', { shares: view.tiles.totalShares, face: formatMoneyMinor(view.tiles.faceValueMinor, 'INR', lang) })
                  : t.t('reg.tile.capitalHintMixed', { shares: view.tiles.totalShares })}
              </span>
            </div>
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('reg.tile.eligible')}</span>
              <strong className="kv-stat__value">{view.tiles.votingEligible.toLocaleString(lang)}</strong>
              <span className="kv-stat__hint">
                {ePct === null ? t.t('reg.tile.eligibleNoBase') : t.t('reg.tile.eligibleHint', { pct: ePct })}
              </span>
            </div>
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('reg.tile.turnout')}</span>
              <strong className="kv-stat__value">
                {turnout?.state === 'known' ? `${turnout.pct}%` : '—'}
              </strong>
              <span className="kv-stat__hint">
                {turnout?.state === 'known'
                  ? t.t('reg.tile.turnoutHint', { cast: turnout.cast ?? 0, title: view.tiles.lastAgm?.title ?? '' })
                  : turnout?.state === 'unrecorded'
                    // The honest sentence. A tile that said "0%" for a well-attended AGM would be worse than one that says
                    // the denominator was never written down.
                    ? t.t('reg.tile.turnoutUnrecorded', { cast: turnout.cast ?? 0 })
                    : t.t('reg.tile.turnoutNone')}
              </span>
            </div>
          </div>

          <h2>{t.t('reg.tableTitle')}</h2>
          <table className="kv-table">
            <caption className="kv-detail__muted">{registerCaption(rows.length, view.tiles, t)}</caption>
            <thead>
              <tr>
                <th scope="col">{t.t('reg.col.member')}</th>
                <th scope="col">{t.t('reg.col.shares')}</th>
                <th scope="col">{t.t('reg.col.value')}</th>
                <th scope="col">{t.t('reg.col.voting')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = verdictLabel(r.verdict, t);
                return (
                  <tr key={r.userId}>
                    <td>
                      {/* The member page is where a reveal happens, under its own grant (TENANT-1b). */}
                      <a href={`/people/${encodeURIComponent(r.userId)}`}>{r.fullName ?? t.t('reg.unnamed')}</a>
                      {r.phoneMasked ? <span className="kv-detail__muted"> · {r.phoneMasked}</span> : null}
                      {r.memberSince ? (
                        <div className="kv-detail__muted">
                          {t.t('reg.since', { d: formatDate(r.memberSince, lang, { dateStyle: 'medium' }) })}
                        </div>
                      ) : null}
                    </td>
                    <td>{r.sharesHeld.toLocaleString(lang)}</td>
                    <td>{formatMoneyMinor(r.valueMinor, 'INR', lang)}</td>
                    <td>
                      <span className={`kv-badge kv-badge--${v.tone === 'ok' ? 'success' : v.tone === 'stop' ? 'danger' : 'muted'}`}>{v.label}</span>
                      {v.detail ? <div className="kv-detail__muted">{v.detail}</div> : null}
                      {r.verdict.eligibleFrom && !r.verdict.eligible ? (
                        <div className="kv-detail__muted">
                          {t.t('reg.eligibleFrom', { d: formatDate(r.verdict.eligibleFrom, lang, { dateStyle: 'medium' }) })}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {view.nextCursor ? (
            <a href={`/governance/register?cursor=${encodeURIComponent(view.nextCursor)}`} className="kv-btn kv-btn--muted kv-btn--sm">
              {t.t('reg.next')}
            </a>
          ) : <p className="kv-detail__muted">{t.t('reg.endOfRegister')}</p>}

          <h2>{t.t('reg.bylawTitle')}</h2>
          <ul className="kv-account-list">
            {bylawRows(view.bylaws, t).map((b, i) => (
              <li key={i}>
                ✓ {b.text}
                {/* The one-member-one-vote row carries no settings link, on purpose: it is not configurable in any tenant,
                    in any country, on any plan. */}
                {b.configurable ? <a href="/settings" className="kv-btn--link"> {t.t('reg.change')}</a> : null}
              </li>
            ))}
          </ul>
          <p className="kv-field__hint">{t.t('reg.bylawNote')}</p>

          <h2>{t.t('reg.allotTitle', { n: view.tiles.pendingAllotment })}</h2>
          <p className="kv-detail__muted">{t.t('reg.allotBody')}</p>
          {/* Named, not faked: there is no allotment path behind this panel yet (TENANT-1e-Q4). */}
          <p className="kv-notice" role="note">{t.t('reg.allotGap')}</p>
          <p className="kv-field__hint kv-note">{t.t('reg.footerNote')}</p>
        </>
      )}
    </section>
  );
}
