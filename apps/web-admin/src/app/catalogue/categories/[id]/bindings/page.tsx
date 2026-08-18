// apps/web-admin/src/app/catalogue/categories/[id]/bindings/page.tsx · A CATEGORY'S ATTRIBUTE BINDINGS
// (PC-56 ADMIN-3, canon W020's Attributes tab). No surface existed for these at all — the join between categories and
// attributes had no read endpoint, no write endpoint and no page.
//
// THE TABLE SHOWS INHERITED BINDINGS ALONGSIDE LOCAL ONES, which is the only honest way to render it: a listing form
// applies the ancestors' bindings too, so a screen showing only what is bound HERE would understate what a farmer is
// actually asked for. The canon does exactly this with its Source column ("bound here" / "inherited: crops").
//
// AND AN INHERITED ROW OFFERS NO EDIT. Not a disabled button — no control at all, with the reason stated once. Editing an
// inherited binding from here would write to a DIFFERENT category than the one the operator is looking at, and the
// resulting audit row would name a category nobody visited.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../../lib/admin-client';
import { getTranslator } from '../../../../../lib/i18n';
import { adminNoticeKey } from '../../../../../features/nav/nav-model';
import { bindAttributeAction, updateBindingAction, unbindAttributeAction } from '../../../actions';
import {
  Button, Callout, EmptyState, StatusPill, type StatusTone,
} from '@krishalaya/ui';
import {
  splitBindings, MIN_REASON, type BindingRow, type AttributeRow,
} from '../../../../../features/catalogue/eav';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('bind.title'), robots: { index: false, follow: false } };
}

interface BindingsView { items: BindingRow[]; localCount: number; inheritedCount: number; note: string | null }

export default async function BindingsPage(
  { params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string; why?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  let view: BindingsView | null = null; let attributes: AttributeRow[] = []; let notice: string | undefined;
  try { view = (await adminGet<BindingsView>(`catalogue/categories/${encodeURIComponent(params.id)}/bindings`)).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }
  // the bindable attribute list. Allowed to fail alone (Law 12).
  try { attributes = (await adminGet<{ items: AttributeRow[] }>('catalogue/attributes', { limit: 200 })).data?.items ?? []; }
  catch { attributes = []; }

  const rows = view?.items ?? [];
  const { local, inherited } = splitBindings(rows);

  const okKey = searchParams.ok?.startsWith('bind_') ? searchParams.ok.slice(5) : undefined;
  const errKey = searchParams.error?.startsWith('bind_') ? searchParams.error.slice(5) : searchParams.error;

  /** The Required column: three states, not two. The canon shows `required` / `optional` / `conditional` and the third is
   *  not a variant of the first — a conditional binding is optional until its condition fires. */
  const requiredLabel = (b: BindingRow) =>
    b.condition ? t.t('bind.requiredConditional') : t.t(b.isRequired ? 'bind.requiredYes' : 'bind.requiredNo');
  const requiredTone = (b: BindingRow): StatusTone =>
    b.condition ? 'warning' : b.isRequired ? 'success' : 'neutral';

  const row = (b: BindingRow) => (
    <tr key={b.id}>
      <td>
        <Link href={`/catalogue/attributes/${encodeURIComponent(b.attributeId)}`}><code>{b.attributeCode}</code></Link>
        {' '}<span className="kv-detail__muted">{b.attributeName}</span>
      </td>
      <td>{t.t(`attr.type.${b.dataType}`)}{b.unitCode ? ` · ${b.unitCode}` : ''}</td>
      <td>{b.source ?? (b.isLocal ? t.t('bind.local') : t.t('common.dash'))}</td>
      <td><StatusPill tone={requiredTone(b)} label={requiredLabel(b)} /></td>
      <td>{b.showInFilters ? '✓' : t.t('common.dash')}</td>
      <td>{b.showOnCard ? '✓' : t.t('common.dash')}</td>
      <td>{b.condition ? <code>{JSON.stringify(b.condition)}</code> : t.t('common.dash')}</td>
      <td>{b.sortOrder}</td>
    </tr>
  );

  const head = (
    <thead><tr>
      <th scope="col">{t.t('bind.attribute')}</th>
      <th scope="col">{t.t('bind.dataType')}</th>
      <th scope="col">{t.t('bind.source')}</th>
      <th scope="col">{t.t('bind.required')}</th>
      <th scope="col">{t.t('bind.inFilters')}</th>
      <th scope="col">{t.t('bind.onCard')}</th>
      <th scope="col">{t.t('bind.condition')}</th>
      <th scope="col">{t.t('bind.sort')}</th>
    </tr></thead>
  );

  return (
    <section>
      <p className="kv-backlink">
        <Link href={`/catalogue/categories/${encodeURIComponent(params.id)}`}>{t.t('cat.back')}</Link>
      </p>
      <h1>{t.t('bind.title')}</h1>
      <p className="kv-muted">{t.t('bind.lead')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`bind.ok.${okKey}`)}</p>}
      {errKey && (
        <p className="kv-error" role="alert">
          {errKey === 'rejected' ? t.t('bind.error.rejected', { why: searchParams.why ?? '' }) : t.t(`bind.error.${errKey}`)}
        </p>
      )}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : rows.length === 0 ? (
        // a real statement: nothing bound AND nothing inherited means a listing here is asked for no attributes at all
        <EmptyState title={t.t('bind.none')} />
      ) : (
        <>
          <table className="kv-table">{head}<tbody>{local.map(row)}{inherited.map(row)}</tbody></table>
          <p className="kv-field__hint">
            {t.t('bind.footer', { local: String(view?.localCount ?? local.length), inherited: String(view?.inheritedCount ?? inherited.length) })}
          </p>
          {/* said once, not per row */}
          {inherited.length > 0 && <Callout>{view?.note ?? t.t('bind.inheritedHint')}</Callout>}
        </>
      )}

      {/* ---------------- bind ---------------- */}
      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('bind.newTitle')}</summary>
        <form action={bindAttributeAction} className="kv-form">
          <input type="hidden" name="categoryId" value={params.id} />
          <label htmlFor="b-attr" className="kv-field__label">{t.t('bind.attributeId')}</label>
          <select id="b-attr" name="attributeId" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('bind.attributeIdHint')}</option>
            {attributes.filter((a) => a.isActive).map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {t.t(`attr.type.${a.dataType}`)}</option>
            ))}
          </select>
          <label className="kv-check" htmlFor="b-req">
            <input id="b-req" type="checkbox" name="isRequired" /> {t.t('bind.required')}
          </label>
          <label className="kv-check" htmlFor="b-filt">
            <input id="b-filt" type="checkbox" name="showInFilters" /> {t.t('bind.inFilters')}
          </label>
          <label className="kv-check" htmlFor="b-card">
            <input id="b-card" type="checkbox" name="showOnCard" /> {t.t('bind.onCard')}
          </label>
          <label htmlFor="b-cond" className="kv-field__label">{t.t('bind.condition')}</label>
          <textarea id="b-cond" name="condition" className="kv-input" rows={2} maxLength={2000}
            placeholder='{"if":{"organic":true},"then":{"required":["cert_no"]}}' />
          <p className="kv-field__hint">{t.t('bind.conditionHint')}</p>
          <label htmlFor="b-sort" className="kv-field__label">{t.t('bind.sort')}</label>
          <input id="b-sort" name="sortOrder" type="number" min={0} max={32767} className="kv-input" />
          <label htmlFor="b-reason" className="kv-field__label">{t.t('eav.reason')}</label>
          <input id="b-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
          <p className="kv-field__hint">{t.t('eav.reasonHint')}</p>
          <Button type="submit">{t.t('bind.bind')}</Button>
        </form>
      </details>

      {/* ---------------- change / unbind — LOCAL bindings only ---------------- */}
      {local.length > 0 && (
        <>
          <details className="kv-card kv-limit-form">
            <summary className="kv-card__title">{t.t('bind.editTitle')}</summary>
            <form action={updateBindingAction} className="kv-form">
              <input type="hidden" name="categoryId" value={params.id} />
              <label htmlFor="e-bind" className="kv-field__label">{t.t('bind.attribute')}</label>
              <select id="e-bind" name="id" className="kv-input" required defaultValue="">
                <option value="" disabled>{t.t('bind.attribute')}</option>
                {/* only the ones this category owns — an inherited row is not offered at all */}
                {local.map((b) => <option key={b.id} value={b.id}>{b.attributeCode}</option>)}
              </select>
              {/* attributeId travels because the API validates the binding as a whole; it is not editable */}
              <input type="hidden" name="attributeId" value={local[0]?.attributeId ?? ''} />
              <label className="kv-check" htmlFor="e-req">
                <input id="e-req" type="checkbox" name="isRequired" /> {t.t('bind.required')}
              </label>
              <label className="kv-check" htmlFor="e-filt">
                <input id="e-filt" type="checkbox" name="showInFilters" /> {t.t('bind.inFilters')}
              </label>
              <label className="kv-check" htmlFor="e-card">
                <input id="e-card" type="checkbox" name="showOnCard" /> {t.t('bind.onCard')}
              </label>
              <label htmlFor="e-cond" className="kv-field__label">{t.t('bind.condition')}</label>
              <textarea id="e-cond" name="condition" className="kv-input" rows={2} maxLength={2000} />
              <label htmlFor="e-sort" className="kv-field__label">{t.t('bind.sort')}</label>
              <input id="e-sort" name="sortOrder" type="number" min={0} max={32767} className="kv-input" />
              <label htmlFor="e-breason" className="kv-field__label">{t.t('eav.reason')}</label>
              <input id="e-breason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
              <Button type="submit">{t.t('bind.save')}</Button>
            </form>
          </details>

          <details className="kv-card kv-limit-form">
            <summary className="kv-card__title">{t.t('bind.unbindTitle')}</summary>
            {/* stated before the control: this is not a delete */}
            <Callout>{t.t('bind.unbindHint')}</Callout>
            <form action={unbindAttributeAction} className="kv-form">
              <input type="hidden" name="categoryId" value={params.id} />
              <label htmlFor="u-bind" className="kv-field__label">{t.t('bind.attribute')}</label>
              <select id="u-bind" name="id" className="kv-input" required defaultValue="">
                <option value="" disabled>{t.t('bind.attribute')}</option>
                {local.map((b) => <option key={b.id} value={b.id}>{b.attributeCode}</option>)}
              </select>
              <label htmlFor="u-breason" className="kv-field__label">{t.t('eav.reason')}</label>
              <input id="u-breason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
              <Button type="submit" variant="danger">{t.t('bind.unbind')}</Button>
            </form>
          </details>
        </>
      )}
    </section>
  );
}
