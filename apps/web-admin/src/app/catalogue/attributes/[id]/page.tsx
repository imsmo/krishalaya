// apps/web-admin/src/app/catalogue/attributes/[id]/page.tsx · THE ATTRIBUTE EDITOR (PC-56 ADMIN-3, canon W027).
//
// The canon calls this the only real editor in the catalogue set, and the thing that makes it an editor rather than a
// form is the CHECKER GATE.
//
// HOW THE GATE WORKS HERE, AND WHY IT IS TWO STEPS. Submitting a change that re-interprets stored data — a new type, a
// new unit, a tighter range on an attribute that 89 categories bind — comes back as a 409 whose message is the real
// consequence list, computed server-side from the real binding count. That text is shown VERBATIM and the acknowledgement
// tick then re-submits. It is deliberately not a modal that summarises: a paraphrase of "the values are not converted"
// is the one sentence somebody needed to read in full.
//
// `code` IS RENDERED DISABLED, not omitted. The canon shows it that way and it is the right choice — an operator needs to
// see the code they cannot change, with the reason beside it, rather than wonder where the field went.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { updateAttributeAction, setAttributeActiveAction, createOptionAction, setOptionActiveAction } from '../../actions';
import {
  Button, Callout, EmptyState, StatusPill,
} from '@krishalaya/ui';
import {
  DATA_TYPES, isNumericType, unitIsMissing, validationSummary, MIN_REASON,
  type AttributeRow, type OptionRow, type UnitRow,
} from '../../../../features/catalogue/eav';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('attr.editTitle'), robots: { index: false, follow: false } };
}

interface HistoryRow { id: string; action: string; reason: string; createdAt: string | null; actorUserId: string }
interface EditorView {
  attribute: AttributeRow; options: OptionRow[]; history: HistoryRow[];
  boundCount: number; checkerNote: string | null; optionsApplicable: boolean; codeEditable: boolean;
}

export default async function AttributeEditorPage(
  { params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string; why?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  let view: EditorView | null = null; let units: UnitRow[] = []; let notice: string | undefined;
  try { view = (await adminGet<EditorView>(`catalogue/attributes/${encodeURIComponent(params.id)}`)).data ?? null; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }
  try { units = (await adminGet<{ items: UnitRow[] }>('catalogue/units')).data?.items ?? []; } catch { units = []; }

  if (!view) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/catalogue/attributes">{t.t('cat.back')}</Link></p>
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  const a = view.attribute;
  const okKey = searchParams.ok?.startsWith('attr_') ? searchParams.ok.slice(5)
    : searchParams.ok?.startsWith('opt_') ? searchParams.ok.slice(4) : undefined;
  const okNs = searchParams.ok?.startsWith('opt_') ? 'opt' : 'attr';
  const errRaw = searchParams.error ?? '';
  const errNs = errRaw.startsWith('opt_') ? 'opt' : 'attr';
  const errKey = errRaw.startsWith('attr_') ? errRaw.slice(5) : errRaw.startsWith('opt_') ? errRaw.slice(4) : errRaw || undefined;
  // the 409 consequence text, returned verbatim by the action
  const checkerWhy = errKey === 'checker' ? (searchParams.why ?? '') : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue/attributes">{t.t('cat.back')}</Link></p>
      <h1><code>{a.code}</code></h1>
      <p className="kv-muted">{a.defaultName} · {t.t(`attr.type.${a.dataType}`)}</p>
      <Callout>{t.t('eav.law9')}</Callout>

      {okKey && <p className="kv-success" role="status">{t.t(`${okNs}.ok.${okKey}`)}</p>}
      {errKey && errKey !== 'checker' && (
        <p className="kv-error" role="alert">
          {errKey === 'rejected' ? t.t(`${errNs}.error.rejected`, { why: searchParams.why ?? '' }) : t.t(`${errNs}.error.${errKey}`)}
        </p>
      )}

      {/* ---------------- the checker gate ---------------- */}
      {checkerWhy && (
        <div className="kv-card kv-limit-form">
          <p className="kv-card__title">{t.t('attr.checkerTitle')}</p>
          <p className="kv-field__hint">{t.t('attr.checkerLead')}</p>
          {/* VERBATIM. The server computed this from the real binding count; a paraphrase would lose the point. */}
          <p className="kv-error" role="alert">{checkerWhy}</p>
        </div>
      )}

      <dl className="kv-detail">
        <dt>{t.t('attr.boundTo')}</dt>
        <dd>{view.boundCount > 0 ? t.t('attr.boundToN', { n: String(view.boundCount) }) : t.t('common.dash')}</dd>
        <dt>{t.t('attr.unit')}</dt>
        <dd>
          {a.unitCode ?? t.t('common.dash')}
          {unitIsMissing(a) && <> <StatusPill tone="warning" label={t.t('attr.unitMissing')} /></>}
        </dd>
        <dt>{t.t('attr.validation')}</dt><dd>{validationSummary(a.validation) ?? t.t('common.dash')}</dd>
        <dt>{t.t('attr.state')}</dt>
        <dd>
          <StatusPill tone={a.isActive ? 'success' : 'neutral'} label={t.t(a.isActive ? 'cat.active' : 'eav.inactive')} />
        </dd>
      </dl>

      {/* said once, above the form, when it applies */}
      {view.checkerNote && <Callout>{view.checkerNote}</Callout>}

      {/* ---------------- edit ---------------- */}
      <h2>{t.t('attr.save')}</h2>
      <form action={updateAttributeAction} className="kv-form kv-limit-form">
        <input type="hidden" name="id" value={params.id} />
        {/* the current values travel with the form so the action can OMIT what did not change — a PATCH echoing every
            field would make the audit row claim a change that never happened */}
        <input type="hidden" name="currentName" value={a.defaultName} />
        <input type="hidden" name="currentType" value={a.dataType} />
        <input type="hidden" name="currentUnit" value={a.unitCode ?? ''} />
        <input type="hidden" name="currentValidation" value={validationSummary(a.validation) ?? ''} />

        <label htmlFor="e-code" className="kv-field__label">{t.t('attr.code')}</label>
        {/* disabled, not hidden: the operator should see what they cannot change, and why */}
        <input id="e-code" className="kv-input" value={a.code} disabled readOnly />
        <p className="kv-field__hint">{t.t('attr.codeImmutable')}</p>

        <label htmlFor="e-name" className="kv-field__label">{t.t('attr.name')}</label>
        <input id="e-name" name="defaultName" className="kv-input" defaultValue={a.defaultName} minLength={2} maxLength={150} />

        <label htmlFor="e-type" className="kv-field__label">{t.t('attr.dataType')}</label>
        <select id="e-type" name="dataType" className="kv-input" defaultValue={a.dataType}>
          {DATA_TYPES.map((d) => <option key={d} value={d}>{t.t(`attr.type.${d}`)}</option>)}
        </select>

        <label htmlFor="e-unit" className="kv-field__label">{t.t('attr.unit')}</label>
        <select id="e-unit" name="unitCode" className="kv-input" defaultValue={a.unitCode ?? ''}>
          <option value="">{t.t('attr.noUnit')}</option>
          {units.filter((u) => u.isActive || u.code === a.unitCode).map((u) => (
            <option key={u.code} value={u.code}>{u.code} — {t.t(`unit.class.${u.unitClass}`)}</option>
          ))}
        </select>
        {!isNumericType(a.dataType) && <p className="kv-field__hint">{t.t('attr.unitOnlyNumeric')}</p>}

        <label htmlFor="e-validation" className="kv-field__label">{t.t('attr.validation')}</label>
        <textarea id="e-validation" name="validation" className="kv-input" rows={2} maxLength={4000}
          defaultValue={validationSummary(a.validation) ?? ''} />
        <p className="kv-field__hint">{t.t('attr.validationHint')}</p>

        {/* the acknowledgement. Rendered only once the server has ASKED for it — offering it up front would let somebody
            tick past a consequence they were never shown. */}
        {checkerWhy && (
          <label className="kv-check" htmlFor="e-ack">
            <input id="e-ack" type="checkbox" name="acknowledgeConsequences" value="true" required />
            {' '}{t.t('attr.checkerConfirm')}
          </label>
        )}

        <label htmlFor="e-reason" className="kv-field__label">{t.t('eav.reason')}</label>
        <input id="e-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
        <p className="kv-field__hint">{t.t('eav.reasonHint')}</p>
        <Button type="submit">{t.t('attr.save')}</Button>
      </form>

      {/* ---------------- allowed values (W024's option set) ---------------- */}
      <h2>{t.t('attr.optionsTitle')}</h2>
      {!view.optionsApplicable ? (
        // stated, not blank: a decimal attribute has no option list and that is not a gap
        <EmptyState title={t.t('attr.optionsNotApplicable')} />
      ) : (
        <>
          <p className="kv-field__hint">{t.t('opt.scopeHint')}</p>
          {view.options.length === 0 ? <EmptyState title={t.t('attr.optionsNone')} /> : (
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('opt.sort')}</th>
                <th scope="col">{t.t('opt.code')}</th>
                <th scope="col">{t.t('opt.name')}</th>
                <th scope="col">{t.t('opt.scope')}</th>
                <th scope="col">{t.t('opt.state')}</th>
              </tr></thead>
              <tbody>
                {view.options.map((o) => (
                  <tr key={o.id}>
                    <td>{o.sortOrder}</td>
                    <td><code>{o.code}</code></td>
                    <td>{o.defaultName}</td>
                    <td>
                      {o.categoryId
                        ? <>{t.t('opt.scopeCategory')} <span className="kv-detail__muted">{o.categoryCode ?? o.categoryId.slice(0, 8)}</span></>
                        : t.t('opt.scopeGlobal')}
                    </td>
                    <td>
                      <StatusPill tone={o.isActive ? 'success' : 'neutral'} label={t.t(o.isActive ? 'cat.active' : 'eav.inactive')} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <details className="kv-card kv-limit-form">
            <summary className="kv-card__title">{t.t('opt.newTitle')}</summary>
            <form action={createOptionAction} className="kv-form">
              <input type="hidden" name="attributeId" value={params.id} />
              <label htmlFor="o-code" className="kv-field__label">{t.t('opt.code')}</label>
              <input id="o-code" name="code" className="kv-input" required placeholder="lokwan" />
              <label htmlFor="o-name" className="kv-field__label">{t.t('opt.name')}</label>
              <input id="o-name" name="defaultName" className="kv-input" required maxLength={150} />
              <label htmlFor="o-sort" className="kv-field__label">{t.t('opt.sort')}</label>
              <input id="o-sort" name="sortOrder" type="number" min={0} max={32767} className="kv-input" />
              <label htmlFor="o-cat" className="kv-field__label">{t.t('opt.categoryId')}</label>
              <input id="o-cat" name="categoryId" className="kv-input" />
              <p className="kv-field__hint">{t.t('opt.categoryIdHint')}</p>
              <label htmlFor="o-reason" className="kv-field__label">{t.t('eav.reason')}</label>
              <input id="o-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
              <Button type="submit">{t.t('opt.create')}</Button>
            </form>
          </details>

          {view.options.length > 0 && (
            <details className="kv-card kv-limit-form">
              <summary className="kv-card__title">{t.t('opt.state')}</summary>
              <p className="kv-field__hint">{t.t('opt.deactivateHint')}</p>
              <form action={setOptionActiveAction} className="kv-form">
                <input type="hidden" name="attributeId" value={params.id} />
                <label htmlFor="o-id" className="kv-field__label">{t.t('opt.code')}</label>
                <select id="o-id" name="id" className="kv-input" required defaultValue="">
                  <option value="" disabled>{t.t('opt.code')}</option>
                  {view.options.map((o) => (
                    <option key={o.id} value={o.id}>{o.code} — {t.t(o.isActive ? 'cat.active' : 'eav.inactive')}</option>
                  ))}
                </select>
                <label htmlFor="o-active" className="kv-field__label">{t.t('opt.state')}</label>
                <select id="o-active" name="isActive" className="kv-input" defaultValue="false">
                  <option value="false">{t.t('attr.deactivate')}</option>
                  <option value="true">{t.t('attr.activate')}</option>
                </select>
                <label htmlFor="o-areason" className="kv-field__label">{t.t('eav.reason')}</label>
                <input id="o-areason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
                <Button type="submit" variant="secondary">{t.t('opt.state')}</Button>
              </form>
            </details>
          )}
        </>
      )}

      {/* ---------------- activate / deactivate ---------------- */}
      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t(a.isActive ? 'attr.deactivate' : 'attr.activate')}</summary>
        <form action={setAttributeActiveAction} className="kv-form">
          <input type="hidden" name="id" value={params.id} />
          <input type="hidden" name="isActive" value={a.isActive ? 'false' : 'true'} />
          <label htmlFor="s-reason" className="kv-field__label">{t.t('eav.reason')}</label>
          <input id="s-reason" name="reason" className="kv-input" required minLength={MIN_REASON} maxLength={1000} />
          <Button type="submit" variant={a.isActive ? 'danger' : 'primary'}>
            {t.t(a.isActive ? 'attr.deactivate' : 'attr.activate')}
          </Button>
        </form>
      </details>

      {/* ---------------- history ---------------- */}
      <h2>{t.t('attr.historyTitle')}</h2>
      {view.history.length === 0 ? (
        // and this is now POSSIBLE to be non-empty: before migration 0102 an attribute change could not be audited at all
        <EmptyState title={t.t('attr.historyNone')} />
      ) : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('attr.histAction')}</th>
            <th scope="col">{t.t('attr.histReason')}</th>
            <th scope="col">{t.t('attr.histWhen')}</th>
            <th scope="col">{t.t('attr.histWho')}</th>
          </tr></thead>
          <tbody>
            {view.history.map((h) => (
              <tr key={h.id}>
                <td>{h.action}</td>
                <td>{h.reason}</td>
                <td>{h.createdAt ?? t.t('common.dash')}</td>
                <td><code>{String(h.actorUserId).slice(0, 8)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
