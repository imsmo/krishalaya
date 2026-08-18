// apps/web-admin/src/app/catalogue/translations/page.tsx · THE COVERAGE MATRIX (PC-56 ADMIN-3b, canon W028).
//
// THIS SCREEN EXISTS TO SHOW A NUMBER HONESTLY, and the number is easy to get wrong in a way that would mislead a founder
// rather than an operator.
//
//   • COVERAGE COUNTS ONLY WHAT A FARMER CAN SEE — human-written, or machine-written AND reviewed. A percentage that
//     included unreviewed drafts would say the platform speaks Tamil when nothing Tamil has reached anybody. So drafts
//     are counted in their OWN section, deliberately far from the percentages.
//   • A KIND WITH NO KEYS SHOWS "no keys", NOT 0%. A red cell beside something nobody has created yet is a criticism of
//     nothing, and it would sit there for ever.
//
// The wave's own finding is stated at the top rather than buried: this table had never been written to, so every name in
// the product has fallen back to English since the platform was built.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { createTranslationAction, requestRunAction } from '../actions';
import {
  Button, Callout, Chip, EmptyState, StatusPill,
} from '@krishalaya/ui';
import {
  TRANSLATABLE_ENTITIES, coverageTone, pctText, totalPending, MIN_REASON, MAX_TEXT,
  type CoverageRow, type LanguageRow, type RunRow,
} from '../../../features/catalogue/translations';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('tr.title'), robots: { index: false, follow: false } };
}

interface CoverageView {
  languages: LanguageRow[]; matrix: CoverageRow[];
  gaps: Array<{ entityType: string; empty: string[] }>;
  pendingByLanguage: Array<{ languageCode: string; pending: number }>;
  basis: string;
}

export default async function TranslationsPage(
  { searchParams }: { searchParams: { ok?: string; error?: string; why?: string; n?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  let view: CoverageView | null = null; let runs: RunRow[] = []; let notice: string | undefined;
  try { view = (await adminGet<CoverageView>('translations/coverage')).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }
  // allowed to fail alone (Law 12): the run ledger is context, and losing it must not take the matrix with it
  try { runs = (await adminGet<{ items: RunRow[] }>('translations/runs')).data?.items ?? []; } catch { runs = []; }

  const languages = view?.languages ?? [];
  const matrix = view?.matrix ?? [];
  const pending = view?.pendingByLanguage ?? [];
  const pendingTotal = totalPending(pending);

  const okKey = searchParams.ok?.startsWith('tr_') ? searchParams.ok.slice(3) : undefined;
  const errKey = searchParams.error?.startsWith('tr_') ? searchParams.error.slice(3) : searchParams.error;

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue">{t.t('cat.back')}</Link></p>
      <h1>{t.t('tr.title')}</h1>
      <p className="kv-muted">{t.t('tr.lead')}</p>
      <Callout>{t.t('tr.law6')}</Callout>

      {okKey && (
        <p className="kv-success" role="status">
          {okKey === 'requested' ? t.t('tr.ok.requested', { n: searchParams.n ?? '0' }) : t.t(`tr.ok.${okKey}`)}
        </p>
      )}
      {errKey && (
        <p className="kv-error" role="alert">
          {errKey === 'scope' ? t.t('tr.error.scope', { why: searchParams.why ?? '' })
            : errKey === 'rejected2' ? t.t('tr.error.rejected2', { why: searchParams.why ?? '' })
              : t.t(`tr.error.${errKey}`)}
        </p>
      )}

      <nav className="kv-filters" aria-label={t.t('cat.nav')}>
        <Chip as={Link} href="/catalogue">{t.t('cat.navTypes')}</Chip>
        <Chip as={Link} href="/catalogue/categories">{t.t('cat.navCategories')}</Chip>
        <Chip as={Link} href="/catalogue/attributes">{t.t('cat.navAttributes')}</Chip>
        <Chip as={Link} href="/catalogue/units">{t.t('cat.navUnits')}</Chip>
        <Chip as={Link} href="/catalogue/translations" aria-current="true" active>{t.t('cat.navTranslations')}</Chip>
        <Chip as={Link} href="/catalogue/crops">{t.t('cat.navCrops')}</Chip>
      </nav>

      <p className="kv-field__hint">
        <Link href="/catalogue/translations/queue">{t.t('tr.queueTitle')}</Link>
        {' · '}<Link href="/catalogue/translations/reviewers">{t.t('tr.reviewersTitle')}</Link>
        {' · '}<Link href="/catalogue/translations/exports">{t.t('texp.title')}</Link>
      </p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <h2>{t.t('tr.coverageTitle')}</h2>
          {/* the sentence that stops the two numbers being confused */}
          <Callout>{view?.basis ?? t.t('tr.coverageBasis')}</Callout>

          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('tr.entityType')}</th>
              <th scope="col">{t.t('tr.keys')}</th>
              {languages.map((l) => <th key={l.code} scope="col" title={l.nameEnglish}>{l.code}</th>)}
            </tr></thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.entityType}>
                  <td>{t.t(`tr.entity.${row.entityType}`)}</td>
                  <td>{row.keys}</td>
                  {row.byLanguage.map((c) => (
                    <td key={c.languageCode}>
                      {/* "no keys", never 0% — the question does not apply */}
                      {c.pct === null
                        ? <StatusPill tone="neutral" label={t.t('tr.notApplicable')} title={t.t('tr.notApplicableHint')} />
                        : <StatusPill tone={coverageTone(c.pct)} label={pctText(c.pct) ?? ''} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* ---------------- drafts, kept well away from the percentages ---------------- */}
          <h2>{t.t('tr.pendingTitle')}</h2>
          {pendingTotal === 0 ? <EmptyState title={t.t('tr.pendingNone')} /> : (
            <>
              <Callout>{t.t('tr.pendingTotal', { n: String(pendingTotal) })}</Callout>
              <p className="kv-field__hint">
                {pending.map((p) => `${p.languageCode}: ${p.pending}`).join(' · ')}
              </p>
            </>
          )}

          {(view?.gaps ?? []).length > 0 && (
            <>
              <h2>{t.t('tr.gapsTitle')}</h2>
              <ul className="kv-list">
                {(view?.gaps ?? []).map((g) => (
                  <li key={g.entityType}>
                    {t.t('tr.gapsRow', { entity: t.t(`tr.entity.${g.entityType}`), langs: g.empty.join(', ') })}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* ---------------- write one by hand ---------------- */}
      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('tr.newTitle')}</summary>
        <p className="kv-field__hint">{t.t('tr.newHint')}</p>
        <form action={createTranslationAction} className="kv-form">
          <label htmlFor="t-kind" className="kv-field__label">{t.t('tr.entityType')}</label>
          <select id="t-kind" name="entityType" className="kv-input" defaultValue="category">
            {TRANSLATABLE_ENTITIES.map((e) => <option key={e} value={e}>{t.t(`tr.entity.${e}`)}</option>)}
          </select>
          <label htmlFor="t-id" className="kv-field__label">{t.t('tr.entityId')}</label>
          <input id="t-id" name="entityId" className="kv-input" required />
          <label htmlFor="t-field" className="kv-field__label">{t.t('tr.field')}</label>
          <input id="t-field" name="field" className="kv-input" required defaultValue="name" />
          <label htmlFor="t-lang" className="kv-field__label">{t.t('tr.language')}</label>
          <select id="t-lang" name="languageCode" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('tr.language')}</option>
            {languages.map((l) => <option key={l.code} value={l.code}>{l.nameNative} ({l.code})</option>)}
          </select>
          <label htmlFor="t-text" className="kv-field__label">{t.t('tr.text')}</label>
          <textarea id="t-text" name="text" className="kv-input" rows={2} required maxLength={MAX_TEXT} />
          <label htmlFor="t-reason" className="kv-field__label">{t.t('eav.reason')}</label>
          <input id="t-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
          <Button type="submit">{t.t('tr.create')}</Button>
        </form>
      </details>

      {/* ---------------- machine runs: recorded, and honest that nothing runs ---------------- */}
      <h2>{t.t('tr.runsTitle')}</h2>
      <Callout>{t.t('tr.runsLead')}</Callout>
      {runs.length === 0 ? <EmptyState title={t.t('tr.runsNone')} /> : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('tr.when')}</th>
            <th scope="col">{t.t('tr.runKinds')}</th>
            <th scope="col">{t.t('tr.runLanguages')}</th>
            <th scope="col">{t.t('tr.runGaps')}</th>
            <th scope="col">{t.t('tr.runProduced')}</th>
            <th scope="col">{t.t('tr.runStatus')}</th>
          </tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.requestedAt}</td>
                <td>{r.entityTypes.join(', ')}</td>
                <td>{r.languageCodes.join(', ')}</td>
                <td>{r.gapCount}</td>
                {/* NULL, never 0 — "not run yet" is not "produced nothing" */}
                <td>{r.producedCount === null
                  ? <span className="kv-detail__muted">{t.t('tr.runNotRun')}</span>
                  : String(r.producedCount)}</td>
                <td>
                  <StatusPill tone={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}
                    label={t.t(`tr.runStatus.${r.status}`)} />
                  {r.detail ? <> <span className="kv-detail__muted">{r.detail}</span></> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('tr.runNewTitle')}</summary>
        <form action={requestRunAction} className="kv-form">
          <fieldset className="kv-fieldset">
            <legend className="kv-field__label">{t.t('tr.runKinds')}</legend>
            {TRANSLATABLE_ENTITIES.slice(0, 4).map((e) => (
              <label key={e} className="kv-check" htmlFor={`rk-${e}`}>
                <input id={`rk-${e}`} type="checkbox" name="entityTypes" value={e} /> {t.t(`tr.entity.${e}`)}
              </label>
            ))}
          </fieldset>
          <fieldset className="kv-fieldset">
            <legend className="kv-field__label">{t.t('tr.runLanguages')}</legend>
            {languages.map((l) => (
              <label key={l.code} className="kv-check" htmlFor={`rl-${l.code}`}>
                <input id={`rl-${l.code}`} type="checkbox" name="languageCodes" value={l.code} /> {l.code}
              </label>
            ))}
          </fieldset>
          <label htmlFor="r-reason" className="kv-field__label">{t.t('eav.reason')}</label>
          <input id="r-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
          <Button type="submit" variant="secondary">{t.t('tr.runRequest')}</Button>
        </form>
      </details>
    </section>
  );
}
