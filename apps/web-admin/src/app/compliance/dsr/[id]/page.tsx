// apps/web-admin/src/app/compliance/dsr/[id]/page.tsx · W042, the DSR detail (PC-56 ADMIN-5).
//
// THIS PAGE EXISTS TO STOP THE PLATFORM CLAIMING SOMETHING IT DID NOT DO.
//
// Before this wave, `Complete` moved an erasure to `completed` with a free-text resolution — and nothing had erased
// anything, because the cooling job's `identity.erasure_ready` event has no consumer anywhere in the monorepo. The
// platform recorded a discharged statutory obligation that had not been discharged.
//
// Now the Complete control IS NOT RENDERED until every in-scope data class carries a recorded action, and the
// outstanding classes are listed in its place. That is maker-checker-by-absence applied to a guard rather than a person:
// a Complete button that always 409s teaches an operator the guard is noise, while an absent one beside the list of
// unevidenced classes teaches them what the work actually is.
//
// The other three things this page can now show, none of which was possible before:
//   • THE ERASURE SCOPE, computed from `data_retention_policies` — what is deleted, anonymised, archived and KEPT BY
//     LAW, with the statute for each. It is the only place a farmer's question "what does delete actually mean" is
//     answered honestly, and `no_policy` is a loud state rather than an empty table.
//   • THE 72-HOUR ACKNOWLEDGE CLOCK. There was no `acknowledged_at` column at all, so "SLA breaches YTD 0" was an
//     unmeasured claim rather than a clean record.
//   • CODED REJECTION GROUNDS — one of three lawful ones, which the data principal receives verbatim and can appeal.
// PII-minimal. No inline styles except a computed bar width.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { dsrStatusKey, canStartDsr, canCompleteDsr, canRejectDsr, type DsrRow } from '../../../../features/compliance/compliance';
import {
  REJECTION_GROUNDS, ERASURE_ACTIONS, groundIsFixableByPrincipal, isRejectionGround,
  slaClass, slaKey, scopeKey, actionClass, rowsText, hasUnrunnableActions,
  completeOfferable, evidenceProgressPct, evidenceClass,
  type ScopeResult, type ScopeLine, type ErasureActionRow, type CompletionCheck, type SlaState,
} from '../../../../features/compliance/erasure';
import { updateDsrAction, rejectDsrAction, acknowledgeDsrAction, recordErasureActionAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('compliance.dsrDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['start', 'complete', 'reject', 'acknowledged', 'recorded']);
const ERR = new Set([
  'action', 'resolution', 'exportMediaId', 'ground', 'dataClass', 'rowsAffected', 'note', 'lawMismatch',
  'notEvidenced', 'noScope', 'secondPerson', 'alreadyAcknowledged', 'dsrInvalid', 'coolingActive',
  'elevation', 'conflict', 'invalid', 'notFound', 'generic',
]);

interface DsrDetail extends DsrRow {
  acknowledgedAt: string | null;
  rejectionGround: string | null;
  countersignedBy: string | null;
  countersignedAt: string | null;
  scope: ScopeResult;
  erasureActions: ErasureActionRow[];
  completable: CompletionCheck | null;
  acknowledgeSla: SlaState;
  resolveSla: SlaState;
  scopeComputedAt: string | null;
  automaticExecution: { available: boolean; reason: string };
}

export default async function DsrDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let dsr: DsrDetail | undefined; let notice: string | undefined;
  try { dsr = (await adminGet<DsrDetail>(`compliance/dsr/${encodeURIComponent(params.id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }
  if (!dsr) {
    return <section><p className="kv-backlink"><Link href="/compliance">{t.t('compliance.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const isErasure = dsr.requestType === 'erasure';
  const sk = scopeKey(dsr.scope);
  const completeOK = completeOfferable(dsr.completable, dsr.requestType);
  const progress = evidenceProgressPct(dsr.completable);

  const scopeCols: Column<ScopeLine>[] = [
    { header: t.t('era.dataClass'), cell: (l) => l.dataClass },
    { header: t.t('era.action'), cell: (l) => <span className={actionClass(l.action)}>{t.t(`era.act.${l.action}`)}</span> },
    {
      header: t.t('era.records'),
      // NULL renders "not counted", never 0 — "0 records" beside kyc_documents is false for anybody who onboarded.
      cell: (l) => { const r = rowsText(l.rows); return r.known ? String(r.n) : <span className="kv-detail__muted">{t.t('era.notCounted')}</span>; },
    },
    {
      header: t.t('era.legalBasis'),
      cell: (l) => (l.legalBasis
        ? <>{l.legalBasis}{l.keptByLaw && <> <span className="kv-status kv-status--muted">{t.t('era.keptByLaw')}</span></>}</>
        : <span className="kv-detail__muted">{t.t('era.noBasis')}</span>),
    },
  ];

  const evidenceCols: Column<ErasureActionRow>[] = [
    { header: t.t('era.dataClass'), cell: (a) => a.dataClass },
    { header: t.t('era.recorded'), cell: (a) => <span className={evidenceClass(a.action)}>{t.t(`era.ev.${a.action}`)}</span> },
    { header: t.t('era.records'), cell: (a) => String(a.rowsAffected) },
    { header: t.t('era.by'), cell: (a) => a.executedBy },
    { header: t.t('era.when'), cell: (a) => a.executedAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/compliance">{t.t('compliance.back')}</Link></p>
      <h1>{t.t(`era.type.${dsr.requestType}`)} — <span className="kv-status">{t.t(`compliance.dsrState.${dsrStatusKey(dsr.status)}`)}</span></h1>
      {okKey && <p className="kv-success" role="status">{t.t(`era.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`era.error.${errKey}`)}</p>}

      {/* THE SLA CLOCKS. `unmeasured` is a warning and not a pass: a request with no acknowledgement timestamp has an
          unread clock, and reporting that as met is how "0 breaches" becomes a claim nobody checked. */}
      <dl className="kv-facts">
        <div className="kv-facts__row">
          <dt>{t.t('era.ackSla')}</dt>
          <dd>
            <span className={slaClass(dsr.acknowledgeSla)}>{t.t(`era.sla.${slaKey(dsr.acknowledgeSla)}`)}</span>
            {dsr.acknowledgedAt ? ` · ${dsr.acknowledgedAt}` : ''}
          </dd>
        </div>
        <div className="kv-facts__row">
          <dt>{t.t('era.resolveSla')}</dt>
          <dd><span className={slaClass(dsr.resolveSla)}>{t.t(`era.sla.${slaKey(dsr.resolveSla)}`)}</span></dd>
        </div>
        {dsr.coolingEndsAt && (
          <div className="kv-facts__row">
            <dt>{t.t('era.cooling')}</dt>
            {/* The cooling window is a RIGHT, not a delay — the farmer can still change their mind, and money history
                often matters at loan season. The resolve clock is held off until it closes for exactly that reason. */}
            <dd>{String(dsr.coolingEndsAt)} <span className="kv-detail__muted">{t.t('era.coolingWhy')}</span></dd>
          </div>
        )}
        {dsr.countersignedBy && (
          <div className="kv-facts__row"><dt>{t.t('era.countersigned')}</dt><dd>{dsr.countersignedBy} · {dsr.countersignedAt}</dd></div>
        )}
        {dsr.rejectionGround && isRejectionGround(dsr.rejectionGround) && (
          <div className="kv-facts__row">
            <dt>{t.t('era.ground')}</dt>
            <dd>
              {t.t(`era.ground.${dsr.rejectionGround}`)}{' '}
              {/* Whether the farmer can fix it themselves changes what happens next for them, so the screen says so. */}
              <span className={groundIsFixableByPrincipal(dsr.rejectionGround) ? 'kv-status kv-status--warn' : 'kv-status kv-status--muted'}>
                {t.t(groundIsFixableByPrincipal(dsr.rejectionGround) ? 'era.groundFixable' : 'era.groundNotFixable')}
              </span>
            </dd>
          </div>
        )}
        {dsr.resolution && <div className="kv-facts__row"><dt>{t.t('compliance.resolution')}</dt><dd>{dsr.resolution}</dd></div>}
      </dl>

      {/* Acknowledging is deliberately NOT elevated and NOT two-person gated — telling somebody you received their
          request is not a decision about their data, and a ceremony in front of it is how the 72 hours get missed. */}
      {!dsr.acknowledgedAt && (
        <form action={acknowledgeDsrAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={dsr.id} />
          <p className="kv-field__hint">{t.t('era.ackHint')}</p>
          <label className="kv-field__label" htmlFor="ackNote">{t.t('era.ackNote')}</label>
          <input id="ackNote" name="note" className="kv-input" maxLength={500} />
          <button type="submit" className="kv-btn">{t.t('era.acknowledge')}</button>
        </form>
      )}

      {isErasure && (
        <>
          <h2>{t.t('era.scopeHeading')}</h2>
          {/* `no_policy` is its OWN state. An empty table under this heading would read as "nothing of yours will be
              kept", which is the opposite of the truth — nobody has decided what happens to anything. */}
          {sk === 'noPolicy' && <p className="kv-error" role="alert">{t.t('era.scopeNoPolicy')}</p>}
          {sk === 'allInactive' && <p className="kv-error" role="alert">{t.t('era.scopeAllInactive')}</p>}
          {sk === 'scope' && dsr.scope.kind === 'scope' && (
            <>
              <p className="kv-muted">{t.t('era.scopeLead', { deletable: String(dsr.scope.deletableCount), kept: String(dsr.scope.keptByLawCount) })}</p>
              {/* The sentence W042 requires in plain language: legal-basis rows are excluded from deletion BY LAW. */}
              <p className="kv-notice">{t.t('era.scopeLawNote')}</p>
              <DataTable columns={scopeCols} rows={dsr.scope.lines} empty={t.t('era.scopeEmpty')} />
              {/* Four of the seeded policies are `anonymise` and two are `archive`, and the retention worker implements
                  `delete` only — it says so in its own comment. A scope line promising anonymisation that nothing
                  performs is the same class of lie as a completed erasure that erased nothing. */}
              {hasUnrunnableActions(dsr.scope) && <p className="kv-notice">{t.t('era.unrunnable', { actions: dsr.scope.unrunnable.join(', ') })}</p>}
              {dsr.scopeComputedAt && <p className="kv-detail__muted">{t.t('era.scopeComputedAt', { at: String(dsr.scopeComputedAt) })}</p>}
            </>
          )}

          <h2>{t.t('era.evidenceHeading')}</h2>
          {/* The finding, said on the screen: nothing consumes the erasure-ready event, so no automatic execution has
              happened or will happen for this request until an executor exists. */}
          {!dsr.automaticExecution.available && <p className="kv-error" role="alert">{t.t('era.noExecutor')}</p>}
          <p className="kv-detail__muted">{t.t('era.evidenceProgress', { pct: String(progress) })}</p>
          <span className="kv-bar" style={{ width: `${progress}%` }} aria-hidden="true" />
          <DataTable columns={evidenceCols} rows={dsr.erasureActions} empty={t.t('era.evidenceEmpty')} />

          {dsr.completable && !dsr.completable.ok && dsr.completable.reason === 'missing_evidence' && (
            <>
              <p className="kv-notice">{t.t('era.missingHeading', { n: String(dsr.completable.missing.length), total: String(dsr.completable.classesInScope) })}</p>
              <ul className="kv-list">{dsr.completable.missing.map((c) => <li key={c}>{c}</li>)}</ul>
            </>
          )}

          <h3>{t.t('era.recordHeading')}</h3>
          <form action={recordErasureActionAction} className="kv-card kv-action-card">
            <input type="hidden" name="id" value={dsr.id} />
            <p className="kv-field__hint">{t.t('era.recordHint')}</p>
            <label className="kv-field__label" htmlFor="dataClass">{t.t('era.dataClass')}</label>
            <input id="dataClass" name="dataClass" className="kv-input" required maxLength={100} placeholder="ledger_entries" />
            <label className="kv-field__label" htmlFor="recAction">{t.t('era.recorded')}</label>
            <select id="recAction" name="action" className="kv-input" defaultValue="deleted">
              {ERASURE_ACTIONS.map((a) => <option key={a} value={a}>{t.t(`era.ev.${a}`)}</option>)}
            </select>
            <label className="kv-field__label" htmlFor="rowsAffected">{t.t('era.records')}</label>
            <input id="rowsAffected" name="rowsAffected" className="kv-input kv-input--sm" inputMode="numeric" placeholder="0" />
            {/* Zero is legitimate and worth recording: a class the farmer had no rows in was still CHECKED, which is the
                difference between "nothing there" and "never looked". */}
            <p className="kv-field__hint">{t.t('era.rowsZeroOk')}</p>
            <label className="kv-field__label" htmlFor="recNote">{t.t('era.note')}</label>
            <input id="recNote" name="note" className="kv-input" maxLength={1000} />
            <button type="submit" className="kv-btn">{t.t('era.record')}</button>
          </form>
        </>
      )}

      <h2>{t.t('compliance.decide')}</h2>
      {canStartDsr(dsr.status) && (
        <form action={updateDsrAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={dsr.id} />
          <input type="hidden" name="action" value="start" />
          {/* Beginning an ERASURE is the checker step (W042: "+ DPO countersign (maker–checker)"). The server refuses a
              countersign by the operator who last worked the request, and so does a CHECK constraint. */}
          <p className="kv-field__hint">{t.t(isErasure ? 'era.startErasureHint' : 'era.startHint')}</p>
          <label className="kv-field__label" htmlFor="startResolution">{t.t('compliance.resolution')}</label>
          <input id="startResolution" name="resolution" className="kv-input" required minLength={3} maxLength={2000} />
          <button type="submit" className="kv-btn">{t.t(isErasure ? 'era.startErasure' : 'era.start')}</button>
        </form>
      )}

      {canCompleteDsr(dsr.status) && (
        completeOK ? (
          <form action={updateDsrAction} className="kv-card kv-action-card">
            <input type="hidden" name="id" value={dsr.id} />
            <input type="hidden" name="action" value="complete" />
            <p className="kv-field__hint">{t.t('era.completeHint')}</p>
            <label className="kv-field__label" htmlFor="completeResolution">{t.t('compliance.resolution')}</label>
            <input id="completeResolution" name="resolution" className="kv-input" required minLength={3} maxLength={2000} />
            <label className="kv-field__label" htmlFor="exportMediaId">{t.t('compliance.exportMediaId')}</label>
            <input id="exportMediaId" name="exportMediaId" className="kv-input" />
            <button type="submit" className="kv-btn">{t.t('era.complete')}</button>
          </form>
        ) : (
          /* THE CONTROL IS NOT HERE. A Complete button that always 409s teaches an operator the guard is noise. */
          <p className="kv-notice">{t.t('era.completeBlocked')}</p>
        )
      )}

      {canRejectDsr(dsr.status) && (
        <form action={rejectDsrAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={dsr.id} />
          {/* Only the three lawful grounds, and the principal receives the ground verbatim and may appeal to the Data
              Protection Board — which is why it is a closed list rather than a sentence somebody types. */}
          <p className="kv-field__hint">{t.t('era.rejectHint')}</p>
          <label className="kv-field__label" htmlFor="ground">{t.t('era.ground')}</label>
          <select id="ground" name="ground" className="kv-input" defaultValue="identity_unverified">
            {REJECTION_GROUNDS.map((g) => <option key={g} value={g}>{t.t(`era.ground.${g}`)}</option>)}
          </select>
          <label className="kv-field__label" htmlFor="rejectResolution">{t.t('era.groundDetail')}</label>
          <input id="rejectResolution" name="resolution" className="kv-input" required minLength={3} maxLength={2000} />
          <button type="submit" className="kv-btn kv-btn--danger">{t.t('era.reject')}</button>
        </form>
      )}
    </section>
  );
}
