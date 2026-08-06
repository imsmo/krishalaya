// apps/web-admin/src/app/catalogue/attributes/page.tsx · ATTRIBUTE DEFINITIONS (PC-56 ADMIN-3, canon W026).
//
// The canon's own subtitle is the most important thing on this screen and it is rendered as a notice rather than as
// small print: "Golden Law 9: attributes are DESCRIPTIVE ONLY — they never drive money or state logic."
//
// TWO FLAGS THE CANON ASKS FOR, both computed rather than stored:
//   • "unit missing" on a numeric attribute with no unit — a farmer would see a bare number with nothing saying what it
//     measures.
//   • "no options yet" on an option attribute with none — the canon says on W024 "add at least one variety before
//     enabling the required binding", and the API refuses that binding, so flagging it here is where the operator finds
//     out cheaply rather than at the point of refusal.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { createAttributeAction } from '../actions';
import {
  DATA_TYPES, unitIsMissing, isUnfillable, validationSummary,
  MIN_REASON, type AttributeRow, type UnitRow,
} from '../../../features/catalogue/eav';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('attr.title'), robots: { index: false, follow: false } };
}

interface AttrView { items: AttributeRow[]; dataTypes: string[] }

export default async function AttributesPage(
  { searchParams }: { searchParams: { q?: string; dataType?: string; withUnit?: string; ok?: string; error?: string; why?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  const dataType = (DATA_TYPES as readonly string[]).includes(searchParams.dataType ?? '') ? searchParams.dataType : undefined;
  const withUnit = searchParams.withUnit === 'true' ? 'true' : undefined;

  let view: AttrView | null = null; let units: UnitRow[] = []; let notice: string | undefined;
  try {
    const res = await adminGet<AttrView>('catalogue/attributes', { q: searchParams.q, dataType, withUnit, limit: 200 });
    view = res.data ?? null;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }
  // the unit list feeds the create form's select. Allowed to fail on its own (Law 12): a missing unit list must not take
  // the attribute registry with it.
  try { units = (await adminGet<{ items: UnitRow[] }>('catalogue/units')).data?.items ?? []; } catch { units = []; }

  const rows = view?.items ?? [];
  const okKey = searchParams.ok?.startsWith('attr_') ? searchParams.ok.slice(5) : undefined;
  const errKey = searchParams.error?.startsWith('attr_') ? searchParams.error.slice(5) : searchParams.error;

  /** ONE href builder for every chip, so a filter cannot survive on one path and not another. */
  const href = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: searchParams.q, dataType, withUnit, ...extra })) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/catalogue/attributes${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue">{t.t('cat.back')}</Link></p>
      <h1>{t.t('attr.title')}</h1>
      <p className="kv-muted">{t.t('attr.lead')}</p>
      {/* the law, stated where it governs — not as small print */}
      <p className="kv-notice" role="note">{t.t('eav.law9')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`attr.ok.${okKey}`)}</p>}
      {errKey && (
        <p className="kv-error" role="alert">
          {errKey === 'rejected' ? t.t('attr.error.rejected', { why: searchParams.why ?? '' }) : t.t(`attr.error.${errKey}`)}
        </p>
      )}

      <nav className="kv-filters" aria-label={t.t('attr.filterAllTypes')}>
        <Link href={href({ dataType: undefined })} className={`kv-chip${!dataType ? ' is-active' : ''}`}
          aria-current={!dataType ? 'true' : undefined}>{t.t('attr.filterAllTypes')}</Link>
        {DATA_TYPES.map((d) => (
          <Link key={d} href={href({ dataType: d })} className={`kv-chip${dataType === d ? ' is-active' : ''}`}
            aria-current={dataType === d ? 'true' : undefined}>{t.t(`attr.type.${d}`)}</Link>
        ))}
        <Link href={href({ withUnit: withUnit ? undefined : 'true' })} className={`kv-chip${withUnit ? ' is-active' : ''}`}
          aria-current={withUnit ? 'true' : undefined}>{t.t('attr.filterWithUnit')}</Link>
      </nav>

      <form method="get" className="kv-inline-form">
        <label className="kv-field__label" htmlFor="attr-q">{t.t('attr.searchLabel')}</label>
        <input id="attr-q" name="q" className="kv-input kv-input--sm" defaultValue={searchParams.q ?? ''} />
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('eav.search')}</button>
      </form>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : rows.length === 0 ? (
        <p className="kv-empty">{t.t('attr.none')}</p>
      ) : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('attr.code')}</th>
            <th scope="col">{t.t('attr.name')}</th>
            <th scope="col">{t.t('attr.dataType')}</th>
            <th scope="col">{t.t('attr.unit')}</th>
            <th scope="col">{t.t('attr.validation')}</th>
            <th scope="col">{t.t('attr.boundTo')}</th>
            <th scope="col">{t.t('attr.options')}</th>
            <th scope="col">{t.t('attr.state')}</th>
          </tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td><Link href={`/catalogue/attributes/${encodeURIComponent(a.id)}`}><code>{a.code}</code></Link></td>
                <td>{a.defaultName}</td>
                <td>{t.t(`attr.type.${a.dataType}`)}</td>
                <td>
                  {a.unitCode ?? t.t('common.dash')}
                  {/* the canon's own warning badge */}
                  {unitIsMissing(a) && <> <span className="kv-status kv-status--warn" title={t.t('attr.unitMissingHint')}>{t.t('attr.unitMissing')}</span></>}
                </td>
                <td>{validationSummary(a.validation) ?? t.t('common.dash')}</td>
                <td>{Number(a.boundTo ?? 0) > 0 ? t.t('attr.boundToN', { n: String(a.boundTo) }) : t.t('common.dash')}</td>
                <td>
                  {Number(a.optionCount ?? 0) > 0 ? String(a.optionCount) : t.t('common.dash')}
                  {isUnfillable(a) && <> <span className="kv-status kv-status--warn" title={t.t('attr.unfillableHint')}>{t.t('attr.unfillable')}</span></>}
                </td>
                <td>
                  <span className={`kv-status ${a.isActive ? 'kv-status--ok' : 'kv-status--muted'}`}>
                    {t.t(a.isActive ? 'cat.active' : 'eav.inactive')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('attr.newTitle')}</summary>
        <p className="kv-field__hint">{t.t('attr.newHint')}</p>
        <form action={createAttributeAction} className="kv-form">
          <label htmlFor="a-code" className="kv-field__label">{t.t('attr.code')}</label>
          <input id="a-code" name="code" className="kv-input" required placeholder="moisture_pct" />
          <label htmlFor="a-name" className="kv-field__label">{t.t('attr.name')}</label>
          <input id="a-name" name="defaultName" className="kv-input" required minLength={2} maxLength={150} />
          <label htmlFor="a-type" className="kv-field__label">{t.t('attr.dataType')}</label>
          <select id="a-type" name="dataType" className="kv-input" defaultValue="text">
            {DATA_TYPES.map((d) => <option key={d} value={d}>{t.t(`attr.type.${d}`)}</option>)}
          </select>
          <label htmlFor="a-unit" className="kv-field__label">{t.t('attr.unit')}</label>
          <select id="a-unit" name="unitCode" className="kv-input" defaultValue="">
            <option value="">{t.t('attr.noUnit')}</option>
            {units.filter((u) => u.isActive).map((u) => (
              <option key={u.code} value={u.code}>{u.code} — {t.t(`unit.class.${u.unitClass}`)}</option>
            ))}
          </select>
          {/* said next to the control, because the form cannot know the chosen type until submit */}
          <p className="kv-field__hint">{t.t('attr.unitOnlyNumeric')}</p>
          <label htmlFor="a-validation" className="kv-field__label">{t.t('attr.validation')}</label>
          <textarea id="a-validation" name="validation" className="kv-input" rows={2} maxLength={4000} placeholder='{"min":0,"max":100}' />
          <p className="kv-field__hint">{t.t('attr.validationHint')}</p>
          <label htmlFor="a-reason" className="kv-field__label">{t.t('eav.reason')}</label>
          <input id="a-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
          <p className="kv-field__hint">{t.t('eav.reasonHint')}</p>
          <button type="submit" className="kv-btn">{t.t('attr.create')}</button>
        </form>
      </details>

      <p className="kv-field__hint">
        <Link href="/catalogue/units">{t.t('unit.title')}</Link>
        {' · '}<Link href="/catalogue/categories">{t.t('cat.navCategories')}</Link>
      </p>
    </section>
  );
}
