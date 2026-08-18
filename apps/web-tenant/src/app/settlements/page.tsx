// apps/web-tenant/src/app/settlements/page.tsx · W147 — the settlement cycle (PC-56 TENANT-4c).
// Server-first, requireSession-gated, noindex, every string via i18n. This route did not exist: there was
// no settlements surface in the tenant console at all, and no cycle behind it either.
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • the cycle is a REAL period with a real state — and a close is two acts by two people, not one button;
//   • "generates 186 statements atomically" is replaced by a COUNT that climbs: one transaction per seller,
//     resumable, because one transaction over 100,000 sellers would cap the scale this platform is built for;
//   • WHY the commission and tax columns read zero — charged to buyers, charged to sellers, or no rule
//     resolved at all, which are three different facts and only one of them is by design;
//   • a seller row whose gross − commission − tax ≠ net is FLAGGED rather than shown as working arithmetic;
//   • how many of this tenant's statements are still the nightly job's DAILY documents.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { tenantHasPerm } from '../../lib/auth';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { DataTable } from '../../components/DataTable';
import {
  approveBlockedBy, canGenerate, cycleStatusKey, deductionNoteKey, NOTE_FLOOR,
  periodLabel, progressKey, refusalKey, rejectBlockedBy, requestBlockedBy, rowNeedsAttention,
} from '../../features/settlements/console';
import { decideCloseAction, generatePassAction, requestCloseAction } from './actions';
import type { SettlementOverview } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('stl.title'), robots: { index: false, follow: false } };
}

export default async function SettlementsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/settlements');
  const t = getTranslator();
  const lang = getLang();
  const canClose = tenantHasPerm('settlement.close');
  const now = new Date();

  if (!canClose) {
    return (
      <section>
        <h1>{t.t('stl.title')}</h1>
        {/* Reflect-never-grant: 0144's `settlement.close` is the API's gate; this reflects it. */}
        <p className="kv-empty" role="status">{t.t('stl.restricted')}</p>
      </section>
    );
  }

  let ov: SettlementOverview | null = null;
  try {
    ov = await tenantClient().settlements.overview();
  } catch {
    ov = null;
  }

  if (!ov) {
    return (
      <section>
        <h1>{t.t('stl.title')}</h1>
        <p className="kv-error" role="alert">{t.t('stl.loadError')}</p>
      </section>
    );
  }

  const c = ov.cycle;
  const requestBlock = c ? requestBlockedBy({ status: c.status, periodEnd: c.periodEnd, sellerCount: ov.sellerCount }, { canClose }, now) : 'notOpen';
  const approveBlock = c ? approveBlockedBy({ status: c.status, requestedBy: c.requestedBy }, null, { canClose }) : 'notPending';
  const rejectBlock = c ? rejectBlockedBy({ status: c.status }, { canClose }) : 'notPending';

  return (
    <section>
      <h1>{t.t('stl.title')}</h1>
      <p className="kv-muted">{t.t('stl.intro')}</p>

      {searchParams.error && <p className="kv-error" role="alert">{t.t(refusalKey(searchParams.error))}</p>}
      {searchParams.ok && <p className="kv-success" role="status">{t.t(`stl.ok.${searchParams.ok}`)}</p>}

      {!c ? <p className="kv-empty" role="status">{t.t('stl.noCycle')}</p> : (
        <div className="kv-cards">
          <div className="kv-card kv-card--money">
            <h2 className="kv-card__title">{t.t('stl.currentCycle')}</h2>
            <p className="kv-card__figure">{formatMoneyMinor(ov.cycleGrossMinor, 'INR', lang)}</p>
            <p className="kv-field__hint">{t.t('stl.cycleGrossHint', { sellers: String(ov.sellerCount), period: periodLabel(c.periodStart, c.periodEnd) })}</p>
            <p className="kv-badge">{t.t(cycleStatusKey(c.status))}</p>
          </div>
          <div className="kv-card">
            <h2 className="kv-card__title">{t.t('stl.progressTitle')}</h2>
            {/* The count, not a claim of atomicity. */}
            <p>{t.t(progressKey(c.progress), {
              generated: String(c.progress.kind === 'not_started' ? 0 : c.progress.generated),
              expected: String(c.progress.kind === 'generating' || c.progress.kind === 'over_generated' ? c.progress.expected : c.statementsGenerated),
              remaining: String(c.progress.kind === 'generating' ? c.progress.remaining : 0),
            })}</p>
            <p className="kv-field__hint">{t.t('stl.progressHint')}</p>
          </div>
          <div className="kv-card">
            <h2 className="kv-card__title">{t.t('stl.signatures')}</h2>
            {c.requestedAt ? <p className="kv-field__hint">{t.t('stl.requestedAt', { at: formatDate(c.requestedAt, lang) })}</p> : <p className="kv-field__hint">{t.t('stl.notRequested')}</p>}
            {c.decidedAt && <p className="kv-field__hint">{t.t('stl.decidedAt', { at: formatDate(c.decidedAt, lang) })}</p>}
            {c.decisionNote && <p className="kv-note">{c.decisionNote}</p>}
            <p className="kv-note">{t.t('stl.twoHumans')}</p>
          </div>
        </div>
      )}

      {c && (
        <>
          <h2 className="kv-section-title">{t.t('stl.closeTitle')}</h2>
          {requestBlock ? (
            <p className="kv-field__hint">{t.t(`stl.closeBlocked.${requestBlock}`)}</p>
          ) : (
            <form action={requestCloseAction} className="kv-card">
              <input type="hidden" name="cycleId" value={c.id} />
              <p>{t.t('stl.requestConfirm', { sellers: String(ov.sellerCount), gross: formatMoneyMinor(ov.cycleGrossMinor, 'INR', lang) })}</p>
              <button type="submit" className="kv-btn">{t.t('stl.requestClose')}</button>
            </form>
          )}

          {approveBlock === 'youRequested' && <p className="kv-note" role="status">{t.t('stl.youRequested')}</p>}
          {!approveBlock && (
            <form action={decideCloseAction} className="kv-card">
              <input type="hidden" name="cycleId" value={c.id} />
              <input type="hidden" name="decision" value="approved" />
              <p>{t.t('stl.approveConfirm', { sellers: String(ov.sellerCount) })}</p>
              <label htmlFor="approveNote" className="kv-field__label">{t.t('stl.noteOptional')}</label>
              <textarea id="approveNote" name="note" rows={2} maxLength={2000} />
              <button type="submit" className="kv-btn">{t.t('stl.approveClose')}</button>
            </form>
          )}
          {!rejectBlock && (
            <form action={decideCloseAction} className="kv-card">
              <input type="hidden" name="cycleId" value={c.id} />
              <input type="hidden" name="decision" value="rejected" />
              <label htmlFor="rejectNote" className="kv-field__label">{t.t('stl.rejectNote')}</label>
              <textarea id="rejectNote" name="note" rows={3} minLength={NOTE_FLOOR} maxLength={2000} required />
              <p className="kv-field__hint">{t.t('stl.rejectNoteHint', { floor: String(NOTE_FLOOR) })}</p>
              <button type="submit" className="kv-btn kv-btn--danger">{t.t('stl.rejectClose')}</button>
            </form>
          )}

          {canGenerate(c.status, c.progress) && (
            <form action={generatePassAction} className="kv-card">
              <input type="hidden" name="cycleId" value={c.id} />
              <p>{t.t('stl.generateHint')}</p>
              <button type="submit" className="kv-btn">{t.t('stl.generate')}</button>
            </form>
          )}
        </>
      )}

      <h2 className="kv-section-title">{t.t('stl.sellersTitle')}</h2>
      {/* W147's own footnote, as data: the BASIS for the deduction columns. */}
      <p className="kv-field__hint">{t.t(deductionNoteKey(ov.deductionBasis))}</p>
      <DataTable
        rows={ov.sellers}
        empty={t.t('stl.sellersEmpty')}
        columns={[
          { header: t.t('stl.colSeller'), cell: (s) => s.sellerName ?? s.sellerUserId.slice(0, 8) },
          { header: t.t('stl.colOrders'), cell: (s) => String(s.orders) },
          { header: t.t('stl.colGross'), cell: (s) => formatMoneyMinor(s.grossMinor, 'INR', lang) },
          { header: t.t('stl.colCommission'), cell: (s) => formatMoneyMinor(s.commissionMinor, 'INR', lang) },
          { header: t.t('stl.colTax'), cell: (s) => formatMoneyMinor(s.taxMinor, 'INR', lang) },
          {
            header: t.t('stl.colNet'),
            cell: (s) => (
              <>
                {formatMoneyMinor(s.netMinor, 'INR', lang)}
                {rowNeedsAttention(s) && <span className="kv-badge kv-badge--warn">{t.t('stl.netMismatch')}</span>}
              </>
            ),
          },
        ]}
      />

      {ov.legacyDailyStatements > 0 && (
        <p className="kv-note" role="status">{t.t('stl.legacyDaily', { count: String(ov.legacyDailyStatements) })}</p>
      )}
      <p className="kv-pager">
        <Link href="/settlements/statements" className="kv-btn--link">{t.t('stl.allStatements', { count: String(ov.statementCount) })}</Link>
      </p>
    </section>
  );
}
