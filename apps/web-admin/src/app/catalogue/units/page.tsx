// apps/web-admin/src/app/catalogue/units/page.tsx · UNITS & CONVERSIONS (PC-56 ADMIN-3, canon W025).
//
// THE CANON'S WARNING IS THE POINT OF THIS SCREEN and it is rendered before anything else: "Regional truth matters:
// bigha differs by state (Gujarat 2.5/acre, UP ~1.6). Factor edits are checker-gated — they change quoted quantities
// platform-wide."
//
// THREE THINGS THIS PAGE DOES THAT THE OLD (NONEXISTENT) SURFACE COULD NOT:
//   1. IT SHOWS INACTIVE UNITS BY DEFAULT. A registry that hides them makes a deactivated unit look deleted, and the next
//      operator creates a duplicate of it.
//   2. IT RENDERS THE FACTOR AS TEXT, NEVER THROUGH A NUMBER. numeric(20,10) does not survive a JS float — the console's
//      only job here is not to undo what the API deliberately kept as a string.
//   3. IT REPORTS PAIRS THAT DISAGREE WITH THEIR OWN INVERSES. quintal→kg = 100 alongside kg→quintal = 0.02 is two
//      plausible rows that cannot both be true, and nothing else in the system would ever notice.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { createUnitAction, setUnitActiveAction, upsertConversionAction } from '../actions';
import {
  UNIT_CLASSES, factorForDisplay, MIN_REASON, type UnitRow, type ConversionRow,
} from '../../../features/catalogue/eav';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('unit.title'), robots: { index: false, follow: false } };
}

interface Inconsistent { fromUnit: string; toUnit: string; factor: string; inverseFactor: string; expected: string }
interface UnitsView {
  items: UnitRow[]; conversions: ConversionRow[];
  inconsistentPairs: Inconsistent[]; inconsistentNote: string | null; regionalNote: string;
}

export default async function UnitsPage(
  { searchParams }: { searchParams: { unitClass?: string; ok?: string; error?: string; why?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  const unitClass = (UNIT_CLASSES as readonly string[]).includes(searchParams.unitClass ?? '') ? searchParams.unitClass : undefined;

  let view: UnitsView | null = null; let notice: string | undefined;
  try { view = (await adminGet<UnitsView>('catalogue/units', { unitClass })).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const units = view?.items ?? [];
  const conversions = view?.conversions ?? [];
  const bad = view?.inconsistentPairs ?? [];

  const okKey = searchParams.ok?.startsWith('unit_') ? searchParams.ok.slice(5) : undefined;
  const errKey = searchParams.error?.startsWith('unit_') ? searchParams.error.slice(5) : searchParams.error;

  const href = (c?: string) => `/catalogue/units${c ? `?unitClass=${encodeURIComponent(c)}` : ''}`;

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue">{t.t('cat.back')}</Link></p>
      <h1>{t.t('unit.title')}</h1>
      <p className="kv-muted">{t.t('unit.lead')}</p>
      {/* first, before any control that could change one */}
      <p className="kv-notice" role="note">{view?.regionalNote ?? t.t('unit.regionalWarn')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`unit.ok.${okKey}`)}</p>}
      {errKey && (
        <p className="kv-error" role="alert">
          {errKey === 'rejected' ? t.t('unit.error.rejected', { why: searchParams.why ?? '' }) : t.t(`unit.error.${errKey}`)}
        </p>
      )}

      {/* the pairs that cannot both be right */}
      {bad.length > 0 && (
        <>
          <p className="kv-error" role="alert">{t.t('unit.inconsistentWarn', { n: String(bad.length) })}</p>
          <ul className="kv-list">
            {bad.map((b) => (
              <li key={`${b.fromUnit}-${b.toUnit}`}>
                {t.t('unit.inconsistentRow', {
                  from: b.fromUnit, to: b.toUnit,
                  factor: factorForDisplay(b.factor) ?? '',
                  inverse: factorForDisplay(b.inverseFactor) ?? '',
                  expected: factorForDisplay(b.expected) ?? '',
                })}
              </li>
            ))}
          </ul>
        </>
      )}

      <nav className="kv-filters" aria-label={t.t('unit.class')}>
        <Link href={href()} className={`kv-chip${!unitClass ? ' is-active' : ''}`} aria-current={!unitClass ? 'true' : undefined}>
          {t.t('attr.filterAllTypes')}
        </Link>
        {UNIT_CLASSES.map((c) => (
          <Link key={c} href={href(c)} className={`kv-chip${unitClass === c ? ' is-active' : ''}`}
            aria-current={unitClass === c ? 'true' : undefined}>{t.t(`unit.class.${c}`)}</Link>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          {units.length === 0 ? <p className="kv-empty">{t.t('unit.none')}</p> : (
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('unit.code')}</th>
                <th scope="col">{t.t('unit.name')}</th>
                <th scope="col">{t.t('unit.class')}</th>
                <th scope="col">{t.t('unit.usedBy')}</th>
                <th scope="col">{t.t('unit.state')}</th>
              </tr></thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.code}>
                    <td><code>{u.code}</code></td>
                    <td>{u.defaultName}</td>
                    <td>{t.t(`unit.class.${u.unitClass}`)}</td>
                    <td>{Number(u.usedByAttrs ?? 0) > 0 ? String(u.usedByAttrs) : t.t('common.dash')}</td>
                    <td>
                      <span className={`kv-status ${u.isActive ? 'kv-status--ok' : 'kv-status--muted'}`}>
                        {t.t(u.isActive ? 'cat.active' : 'eav.inactive')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>{t.t('unit.convTitle')}</h2>
          {conversions.length === 0 ? <p className="kv-empty">{t.t('unit.convNone')}</p> : (
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('unit.from')}</th>
                <th scope="col">{t.t('unit.to')}</th>
                <th scope="col">{t.t('unit.factor')}</th>
                <th scope="col">{t.t('unit.class')}</th>
              </tr></thead>
              <tbody>
                {conversions.map((c) => (
                  <tr key={`${c.fromUnit}-${c.toUnit}`}>
                    <td><code>{c.fromUnit}</code></td>
                    <td><code>{c.toUnit}</code></td>
                    {/* trailing zeros trimmed for reading only; the value is the API's string, never parsed */}
                    <td>{factorForDisplay(c.factor) ?? t.t('common.dash')}</td>
                    <td>{c.unitClass ? t.t(`unit.class.${c.unitClass}`) : t.t('common.dash')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* ---------------- add a unit ---------------- */}
      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('unit.newTitle')}</summary>
        <form action={createUnitAction} className="kv-form">
          <label htmlFor="u-code" className="kv-field__label">{t.t('unit.code')}</label>
          <input id="u-code" name="code" className="kv-input" required maxLength={20} placeholder="quintal" />
          <label htmlFor="u-name" className="kv-field__label">{t.t('unit.name')}</label>
          <input id="u-name" name="defaultName" className="kv-input" required maxLength={60} />
          <label htmlFor="u-class" className="kv-field__label">{t.t('unit.class')}</label>
          <select id="u-class" name="unitClass" className="kv-input" defaultValue="mass">
            {UNIT_CLASSES.map((c) => <option key={c} value={c}>{t.t(`unit.class.${c}`)}</option>)}
          </select>
          <label htmlFor="u-reason" className="kv-field__label">{t.t('eav.reason')}</label>
          <input id="u-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
          <p className="kv-field__hint">{t.t('eav.reasonHint')}</p>
          <button type="submit" className="kv-btn">{t.t('unit.create')}</button>
        </form>
      </details>

      {/* ---------------- set a factor ---------------- */}
      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('unit.convNewTitle')}</summary>
        <p className="kv-field__hint">{t.t('unit.sameClassOnly')}</p>
        <form action={upsertConversionAction} className="kv-form">
          <label htmlFor="c-from" className="kv-field__label">{t.t('unit.from')}</label>
          <select id="c-from" name="fromUnit" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('unit.from')}</option>
            {units.filter((u) => u.isActive).map((u) => (
              <option key={u.code} value={u.code}>{u.code} — {t.t(`unit.class.${u.unitClass}`)}</option>
            ))}
          </select>
          <label htmlFor="c-to" className="kv-field__label">{t.t('unit.to')}</label>
          <select id="c-to" name="toUnit" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('unit.to')}</option>
            {units.filter((u) => u.isActive).map((u) => (
              <option key={u.code} value={u.code}>{u.code} — {t.t(`unit.class.${u.unitClass}`)}</option>
            ))}
          </select>
          {/* type=text, NOT type=number: a number input would let the browser normalise "2.5000000000" and the whole
              string-all-the-way-down chain exists to stop exactly that */}
          <label htmlFor="c-factor" className="kv-field__label">{t.t('unit.factor')}</label>
          <input id="c-factor" name="factor" type="text" inputMode="decimal" pattern="\d{1,10}(\.\d{1,10})?"
            className="kv-input" required placeholder="100" />
          <p className="kv-field__hint">{t.t('unit.factorHint')}</p>
          <label htmlFor="c-reason" className="kv-field__label">{t.t('eav.reason')}</label>
          <input id="c-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
          <button type="submit" className="kv-btn kv-btn--danger">{t.t('unit.convSave')}</button>
        </form>
      </details>

      {/* ---------------- activate / deactivate ---------------- */}
      {units.length > 0 && (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('unit.state')}</summary>
          <form action={setUnitActiveAction} className="kv-form">
            <label htmlFor="ua-code" className="kv-field__label">{t.t('unit.code')}</label>
            <select id="ua-code" name="code" className="kv-input" required defaultValue="">
              <option value="" disabled>{t.t('unit.code')}</option>
              {units.map((u) => (
                <option key={u.code} value={u.code}>{u.code} — {t.t(u.isActive ? 'cat.active' : 'eav.inactive')}</option>
              ))}
            </select>
            <label htmlFor="ua-active" className="kv-field__label">{t.t('unit.state')}</label>
            <select id="ua-active" name="isActive" className="kv-input" defaultValue="false">
              <option value="false">{t.t('attr.deactivate')}</option>
              <option value="true">{t.t('attr.activate')}</option>
            </select>
            <label htmlFor="ua-reason" className="kv-field__label">{t.t('eav.reason')}</label>
            <input id="ua-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
            <button type="submit" className="kv-btn kv-btn--muted">{t.t('unit.state')}</button>
          </form>
        </details>
      )}

      <p className="kv-field__hint"><Link href="/catalogue/attributes">{t.t('attr.title')}</Link></p>
    </section>
  );
}
