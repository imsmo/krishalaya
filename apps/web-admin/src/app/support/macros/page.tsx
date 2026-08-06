// apps/web-admin/src/app/support/macros/page.tsx · CANNED RESPONSES (PC-56 ADMIN-2, canon W053; tables in migration
// 0096). Server component: requireAdmin gates, adminGet reads the macro list with its coverage and usage.
//
// WHY THIS SCREEN LEADS WITH MISSING LANGUAGES. A macro is how the platform says the same true thing twice — twelve
// questions about money make up most of a support day, and retyped answers drift, so two farmers asking when their
// payout arrives get different promises. The failure mode is not a missing macro; it is a macro that exists ONLY IN
// ENGLISH and therefore gets pasted in English to a Gujarati farmer. That gap is invisible unless something names it,
// so the list sorts by it: the macro used four hundred times with a missing language is above the fully-translated one
// used nine hundred times.
//
// "No CSAT" is shown as UNRATED, never as a low score: a macro used twenty times with no ratings is a different fact
// from one that upset everybody.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { bpsToPercent } from '../../../features/reports/report';
import {
  MACRO_LANGUAGES, missingLanguages, sortMacrosByCoverageRisk, usedButUnrated, MIN_BODY, type MacroRow,
} from '../../../features/support/desk';
import { createMacroAction, toggleMacroAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mac.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'archived', 'restored']);
const ERR = new Set(['mac_slug', 'mac_title', 'mac_english', 'mac_body', 'mac_language', 'mac_duplicate',
  'mac_reason', 'elevation', 'notFound', 'generic', 'illegal']);

export default async function MacrosPage({ searchParams }: {
  searchParams: { ok?: string; error?: string; lang?: string; missing?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  let items: MacroRow[] = []; let notice: string | undefined;
  try { items = (await adminGet<{ items: MacroRow[] }>('support/macros')).data?.items ?? []; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const rows = sortMacrosByCoverageRisk(items);
  const gaps = rows.filter((m) => missingLanguages(m.languages).length > 0).length;

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p>
      <h1>{t.t('mac.title')}</h1>
      <p className="kv-field__hint">{t.t('mac.hint')}</p>

      {okKey && (
        <p className="kv-success" role="status">
          {t.t(`mac.ok.${okKey}`)}
          {/* said at the moment of creation, when it is cheapest to fix */}
          {okKey === 'created' && searchParams.missing && searchParams.missing !== '0' &&
            <> <strong>{t.t('mac.createdMissing', { n: searchParams.missing })}</strong></>}
        </p>
      )}
      {errKey && (
        <p className="kv-error" role="alert">
          {t.t(`mac.error.${errKey}`)}
          {searchParams.lang && <> ({t.t(`mac.lang.${searchParams.lang}`)})</>}
        </p>
      )}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          {gaps > 0 && <p className="kv-notice" role="note">{t.t('mac.gapSummary', { n: String(gaps) })}</p>}
          {rows.length === 0 ? <p className="kv-empty">{t.t('mac.none')}</p> : (
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('mac.shortcut')}</th>
                <th scope="col">{t.t('mac.macroTitle')}</th>
                <th scope="col">{t.t('mac.languages')}</th>
                <th scope="col">{t.t('mac.used30d')}</th>
                <th scope="col">{t.t('mac.csatAfter')}</th>
                <th scope="col">{t.t('mac.state')}</th>
              </tr></thead>
              <tbody>
                {rows.map((m) => {
                  const missing = missingLanguages(m.languages);
                  return (
                    <tr key={m.id}>
                      <td><code>/{m.slug}</code></td>
                      <td>{m.title}</td>
                      <td>
                        {(m.languages ?? []).join(', ') || t.t('common.dash')}
                        {/* the gap, named on the row that has it */}
                        {missing.length > 0 && (
                          <> <span className="kv-status kv-status--warn">
                            {t.t('mac.missing', { langs: missing.map((l) => t.t(`mac.lang.${l}`)).join(', ') })}
                          </span></>
                        )}
                      </td>
                      <td>{String(m.uses30d ?? 0)}</td>
                      <td>
                        {usedButUnrated(m)
                          ? <span className="kv-detail__muted">{t.t('mac.unrated')}</span>
                          : m.csatAfterUseBps === null || m.csatAfterUseBps === undefined
                            ? t.t('common.dash')
                            : `${bpsToPercent(m.csatAfterUseBps)}%`}
                      </td>
                      <td>
                        <span className={`kv-status ${m.isActive ? '' : 'kv-status--muted'}`}>
                          {t.t(m.isActive ? 'mac.active' : 'mac.archived')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Archive / restore, one row at a time with a reason. */}
          {rows.length > 0 && (
            <details className="kv-card kv-limit-form">
              <summary className="kv-card__title">{t.t('mac.archiveTitle')}</summary>
              <p className="kv-field__hint">{t.t('mac.archiveHint')}</p>
              <form action={toggleMacroAction} className="kv-form">
                <label htmlFor="mac-id" className="kv-field__label">{t.t('mac.shortcut')}</label>
                <select id="mac-id" name="id" className="kv-input" defaultValue="">
                  <option value="" disabled>{t.t('mac.chooseMacro')}</option>
                  {rows.map((m) => (
                    <option key={m.id} value={String(m.id)}>/{m.slug} — {t.t(m.isActive ? 'mac.active' : 'mac.archived')}</option>
                  ))}
                </select>
                <label htmlFor="mac-active" className="kv-field__label">{t.t('mac.newState')}</label>
                <select id="mac-active" name="active" className="kv-input" defaultValue="false">
                  <option value="false">{t.t('mac.archiveIt')}</option>
                  <option value="true">{t.t('mac.restoreIt')}</option>
                </select>
                <label htmlFor="mac-reason" className="kv-field__label">{t.t('support.reason')}</label>
                <input id="mac-reason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
                <button type="submit" className="kv-btn kv-btn--muted">{t.t('mac.applyState')}</button>
              </form>
            </details>
          )}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('mac.newTitle')}</summary>
        <p className="kv-field__hint">{t.t('mac.newHint', { min: String(MIN_BODY) })}</p>
        <form action={createMacroAction} className="kv-form">
          <label htmlFor="mac-slug" className="kv-field__label">{t.t('mac.shortcut')}</label>
          <input id="mac-slug" name="slug" className="kv-input" required placeholder="/payout-verify-wait" />
          <p className="kv-field__hint">{t.t('mac.slugHint')}</p>
          <label htmlFor="mac-title" className="kv-field__label">{t.t('mac.macroTitle')}</label>
          <input id="mac-title" name="title" className="kv-input" required minLength={3} maxLength={150} />
          {MACRO_LANGUAGES.map((lang) => (
            <div key={lang}>
              <label htmlFor={`body-${lang}`} className="kv-field__label">
                {t.t(`mac.lang.${lang}`)}{lang === 'en' ? ` — ${t.t('mac.required')}` : ''}
              </label>
              <textarea id={`body-${lang}`} name={`body_${lang}`} className="kv-input" rows={3} maxLength={4000}
                required={lang === 'en'} />
            </div>
          ))}
          <p className="kv-field__hint">{t.t('mac.englishHint')}</p>
          <label htmlFor="mac-notes" className="kv-field__label">{t.t('mac.notes')}</label>
          <input id="mac-notes" name="notes" className="kv-input" maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('mac.create')}</button>
        </form>
      </details>
    </section>
  );
}
