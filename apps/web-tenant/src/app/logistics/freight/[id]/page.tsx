// apps/web-tenant/src/app/logistics/freight/[id]/page.tsx · W242 (Freight reconciliation) — one carrier bill, line
// by line (PC-56 TENANT-5c). Server-first, requireSession-gated, noindex. Hosts W2616/W2617/W2618's confirm →
// success → failure chain for [Dispute line], [Resolve line] and [Close recon], with the step in the URL so Back
// works and no client JS is needed.
//
// WHAT THIS SCREEN SAYS THAT W242 CANNOT:
//   • **"Pay matched lines (₹92,000, checker)" is not a button.** There is no payee for a carrier on these rails
//     (`payouts.bank_account_id` NOT NULL; `bank_accounts` needs a user or a tenant; a carrier is neither), no
//     freight `payout_purpose`, and `PayoutService.requestPayout` is a member-withdrawal path gated on the CALLING
//     USER's KYC. The clean figure is printed, the missing pieces are named, and no control is drawn that would 500
//     — or, far worse, appear to have paid a carrier;
//   • **"Every claim cites our shipment_events — timestamped, GPS-tagged, signed-exportable"** is three claims and
//     they are not equally true. Timestamped: yes. GPS: only where the reporting client sent coordinates, which the
//     copy says. Signed-exportable: **there is no export at all** — no signer, no document, no media row. An
//     operator told their pack was signed-exportable would walk into a carrier meeting holding a screenshot;
//   • **the settlement path's first and third steps do not exist.** Step 1 needs the rail. Step 3 promises "agreed
//     lines pay in the next cycle; withdrawn lines close with a credit note" — there is no next-cycle payment and no
//     credit note anywhere in this schema. `resolveLine` records the agreed amount against the line, and that is the
//     whole of what happens;
//   • and **the footing is checked, not asserted.** W242's "recon foots to the rupee ✓" is computed here in BigInt
//     from the disputed rows, and the tick only appears when the three figures actually agree AND every disputed
//     line had an expected figure to be checked against — which, on a platform where nothing writes
//     `shipments.charge_minor`, is usually not the case.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { DataTable } from '../../../../components/DataTable';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { FreightReconDetail } from '@krishalaya/sdk-js';
import {
  EVIDENCE_CLAIMS, SETTLEMENT_STEPS, canDispute, canPay, checkerKey, detailState, disputeBlockedKey,
  disputedFooting, duplicateClaimMinor, duplicateKey, duplicatesFor, evidenceClaimKey,
  evidenceFacts, expectedKey, freightErrorKey, freightOkKey, isFreightAction, matchedSummary, packKey, paymentKey,
  reasonKey, reconHref, settlementBuilt, settlementKey, stateKey, statusKey,
  varianceIsPartial, variancePctText, verdictKey, verdictTone,
} from '../../../../features/logistics/freight';
import { closeFreightAction, disputeFreightLineAction, reconcileFreightAction, resolveFreightLineAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('freight.recon.title'), robots: { index: false, follow: false } };
}

const TONE_CLASS: Record<'ok' | 'warn' | 'bad' | 'muted', string> = {
  ok: 'kv-badge', warn: 'kv-badge kv-badge--warn', bad: 'kv-badge kv-badge--danger', muted: 'kv-badge kv-badge--muted',
};

export default async function FreightReconPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { act?: string; line?: string; ok?: string; error?: string };
}) {
  await requireSession(`/logistics/freight/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let detail: FreightReconDetail | null = null;
  let state = 'ok' as ReturnType<typeof detailState>;
  try {
    detail = await tenantClient().freight.recon(params.id);
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    state = detailState(err?.code ?? 'generic', err?.status);
  }

  const act = isFreightAction(searchParams.act) ? searchParams.act : null;
  const line = detail && searchParams.line ? detail.lines.find((l) => l.id === searchParams.line) ?? null : null;
  const okKey = searchParams.ok ? freightOkKey(searchParams.ok) : null;
  const errKey = searchParams.error ? freightErrorKey(searchParams.error) : null;

  if (state !== 'ok' || !detail) {
    return (
      <section>
        <h1>{t.t('freight.recon.title')}</h1>
        <div className={state === 'flaggedOff' ? 'kv-card kv-card--notice' : 'kv-error'} role={state === 'flaggedOff' ? 'status' : 'alert'}>
          <p>{t.t(stateKey(state))}</p>
          <p><Link href="/logistics/freight" className="kv-btn--link">{t.t('freight.backToDesk')}</Link></p>
        </div>
      </section>
    );
  }

  const inv = detail.invoice;
  const matched = matchedSummary(detail.lines);
  const footing = disputedFooting(detail.lines);
  const money = (m: string) => formatMoneyMinor(m, inv.currencyCode, lang);

  return (
    <section>
      <p className="kv-field__hint">
        <Link href="/logistics/freight" className="kv-link">{t.t('freight.backToDesk')}</Link>
      </p>
      <h1>{inv.invoiceNo}</h1>
      <p className="kv-field__hint">
        {inv.carrierName ?? t.t('freight.carrier.unknown')}
        {' · '}{formatDate(inv.periodStart, lang)} – {formatDate(inv.periodEnd, lang)}
        {' · '}<span className="kv-badge">{t.t(statusKey(inv.reconStatus))}</span>
        {inv.paymentHold && <> <span className="kv-badge kv-badge--muted">{t.t('freight.hold')}</span></>}
      </p>

      {okKey && <p className="kv-success" role="status">{t.t(okKey)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(errKey)}</p>}

      {/* ---- W242's lead sentence, counted from the rows ---- */}
      <p>
        {formatNumber(detail.lines.length, lang)} {t.t('freight.linesBilled')} {money(inv.billedMinor)}
        {detail.expected.kind !== 'unpriced' && <> {t.t('freight.vsExpected')} {money(inv.expectedMinor)}</>}
        {' · '}{formatNumber(matched.lines, lang)} {t.t('freight.linesMatch')} ({money(matched.billedMinor)})
      </p>
      {/* The expected side's own state, on every screen that shows a variance. Without this sentence a real bill
          reconciles against ₹0 and every invoice reads as total leakage. */}
      <p className={varianceIsPartial(detail.expected) ? 'kv-card kv-card--notice' : 'kv-field__hint'} role={varianceIsPartial(detail.expected) ? 'status' : undefined}>
        {t.t(expectedKey(detail.expected))}
        {detail.expected.kind === 'partly_priced' && (
          <> ({formatNumber(detail.expected.pricedLines, lang)}/{formatNumber(detail.expected.pricedLines + detail.expected.unpricedLines, lang)})</>
        )}
        {inv.expectedApplies && inv.varianceDirection !== 'level' && (
          <> · {money(inv.varianceMinor)}
            {variancePctText(inv.varianceBps) !== null && <> ({variancePctText(inv.varianceBps)})</>}
          </>
        )}
      </p>

      {/* ---- the money: what is clean, what is disputed, and why nothing can be paid ---- */}
      <div className="kv-card">
        <h2>{t.t('freight.pay.heading')}</h2>
        <p>{t.t(paymentKey(detail.payment))}</p>
        {detail.payment.kind === 'ready_no_rail' && (
          <>
            <p><strong>{money(detail.payment.cleanMinor)}</strong> {t.t('freight.pay.cleanReady')}</p>
            <p className="kv-field__hint">{t.t('freight.pay.missing')} {detail.payment.missing.map((m) => t.t(`freight.pay.missing.${m}`)).join(', ')}</p>
            {checkerKey(detail.payment) && <p className="kv-field__hint">{t.t(checkerKey(detail.payment)!)}</p>}
          </>
        )}
        {detail.payment.kind === 'held_recon_open' && (
          <p className="kv-field__hint">
            {t.t('freight.pay.cleanHeld')} {money(detail.payment.cleanMinor)}
            {' · '}{t.t('freight.pay.disputedNow')} {money(detail.payment.disputedMinor)}
          </p>
        )}
        {/* Written as a guard rather than as absent markup, so the day a vendor-payment rail exists there is exactly
            one place to turn the control on — and until then nothing here can be mistaken for a payment. */}
        {canPay(detail.payment) && <p className="kv-error" role="alert">{t.t('freight.pay.unreachable')}</p>}
      </div>

      {/* ---- W2616: the confirm steps. Every one of these writes an audit row with an actor. ---- */}
      {act === 'dispute' && line && (
        <form action={disputeFreightLineAction} className="kv-card kv-card--notice">
          <h2>{t.t('freight.act.dispute.title')}</h2>
          <p>
            {line.awbNo ?? line.shipmentId ?? t.t('common.dash')}
            {' · '}{money(line.billedMinor)}
            {line.expectedMinor !== null && <> {t.t('freight.vsExpected')} {money(line.expectedMinor)}</>}
          </p>
          <p className="kv-field__hint">{t.t('freight.act.dispute.body')}</p>
          <label className="kv-field__label" htmlFor="d-reason">{t.t('freight.act.dispute.reason')}</label>
          <textarea id="d-reason" name="reason" className="kv-input" rows={3} minLength={10} maxLength={1000} required />
          <p className="kv-field__hint">{t.t('freight.act.dispute.classified')}</p>
          <input type="hidden" name="id" value={inv.id} />
          <input type="hidden" name="lineId" value={line.id} />
          <button type="submit" className="kv-btn">{t.t('freight.act.proceed')}</button>{' '}
          <Link href={reconHref(inv.id)} className="kv-btn--link">{t.t('freight.act.cancel')}</Link>
        </form>
      )}

      {act === 'resolve' && line && (
        <form action={resolveFreightLineAction} className="kv-card kv-card--notice">
          <h2>{t.t('freight.act.resolve.title')}</h2>
          <p>
            {line.awbNo ?? line.shipmentId ?? t.t('common.dash')}
            {' · '}{money(line.billedMinor)}
            {reasonKey(line.disputeReasonCode) && <> · {t.t(reasonKey(line.disputeReasonCode)!)}</>}
          </p>
          <p className="kv-field__hint">{t.t('freight.act.resolve.body')}</p>
          <label className="kv-field__label" htmlFor="r-outcome">{t.t('freight.act.resolve.outcome')}</label>
          <select id="r-outcome" name="outcome" className="kv-input" defaultValue="agreed">
            <option value="agreed">{t.t('freight.act.resolve.agreed')}</option>
            <option value="withdrawn">{t.t('freight.act.resolve.withdrawn')}</option>
          </select>
          <label className="kv-field__label" htmlFor="r-amount">{t.t('freight.act.resolve.amount')}</label>
          <input id="r-amount" name="agreedMinor" className="kv-input" inputMode="numeric" pattern="\d{1,18}" />
          <p className="kv-field__hint">{t.t('freight.act.resolve.minorHint')}</p>
          <p className="kv-field__hint">{t.t('freight.act.resolve.noCreditNote')}</p>
          <input type="hidden" name="id" value={inv.id} />
          <input type="hidden" name="lineId" value={line.id} />
          <button type="submit" className="kv-btn">{t.t('freight.act.proceed')}</button>{' '}
          <Link href={reconHref(inv.id)} className="kv-btn--link">{t.t('freight.act.cancel')}</Link>
        </form>
      )}

      {act === 'close' && (
        <form action={closeFreightAction} className="kv-card kv-card--notice">
          <h2>{t.t('freight.act.close.title')}</h2>
          <p>{t.t('freight.act.close.body')}</p>
          <p className="kv-field__hint">{t.t('freight.act.close.releasesHold')}</p>
          <input type="hidden" name="id" value={inv.id} />
          <input type="hidden" name="back" value={reconHref(inv.id)} />
          <button type="submit" className="kv-btn">{t.t('freight.act.proceed')}</button>{' '}
          <Link href={reconHref(inv.id)} className="kv-btn--link">{t.t('freight.act.cancel')}</Link>
        </form>
      )}

      {act === 'reconcile' && (
        <form action={reconcileFreightAction} className="kv-card kv-card--notice">
          <h2>{t.t('freight.act.reconcile.title')}</h2>
          <p>{t.t('freight.act.reconcile.body')}</p>
          <input type="hidden" name="id" value={inv.id} />
          <input type="hidden" name="back" value={reconHref(inv.id)} />
          <button type="submit" className="kv-btn">{t.t('freight.act.proceed')}</button>{' '}
          <Link href={reconHref(inv.id)} className="kv-btn--link">{t.t('freight.act.cancel')}</Link>
        </form>
      )}

      {/* ---- W242's four-column table: Shipment | Billed | Expected | Why it differs ---- */}
      <DataTable
        rows={detail.lines}
        empty={t.t('freight.recon.noLines')}
        columns={[
          {
            header: t.t('freight.colLine'),
            cell: (l) => (
              <>
                {/* The carrier's own reference first: it is what appears on the paper an operator is holding, and
                    our uuid appears on nothing the carrier has ever seen. */}
                {l.awbNo ?? <span className="kv-field__hint">{t.t('freight.awb.none')}</span>}
                {l.shipmentId && <><br /><span className="kv-field__hint">{l.shipmentId.slice(0, 8)}…</span></>}
              </>
            ),
          },
          { header: t.t('freight.colBilled'), cell: (l) => money(l.billedMinor) },
          {
            header: t.t('freight.colExpected'),
            cell: (l) => (l.expectedMinor !== null ? money(l.expectedMinor) : <span className="kv-field__hint">{t.t('common.dash')}</span>),
          },
          {
            header: t.t('freight.colWhy'),
            cell: (l) => (
              <>
                <span className={TONE_CLASS[verdictTone(l.verdict)]}>{t.t(verdictKey(l.verdict))}</span>
                {/* The double bill: the same consignment on another of this tenant's invoices. Not a price
                    argument — a real shipment billed twice, which no per-invoice check can see. */}
                {duplicatesFor(detail.duplicates, l.awbNo) > 0 && (
                  <> <span className="kv-badge kv-badge--danger">{t.t(duplicateKey(duplicatesFor(detail.duplicates, l.awbNo))!)}</span></>
                )}
                {(l.verdict.kind === 'over' || l.verdict.kind === 'under') && <> {money(l.verdict.varianceMinor)}</>}
                {l.billedAttempts !== null && <> · {t.t('freight.attemptsBilled')} {formatNumber(l.billedAttempts, lang)}</>}
                {reasonKey(l.disputeReasonCode) && <><br />{t.t(reasonKey(l.disputeReasonCode)!)}</>}
                {l.disputeReason && <><br /><span className="kv-field__hint">{l.disputeReason}</span></>}
                {/* The evidence as it was STORED, never re-derived at render time: a pack has to show what was
                    snapshotted when the dispute was raised, or it is not evidence of anything. */}
                {evidenceFacts(l.evidence).map((f) => (
                  <span key={f.key} className="kv-field__hint"><br />{t.t(f.key)}{f.value ? ` ${f.value}` : ''}</span>
                ))}
              </>
            ),
          },
          {
            header: t.t('freight.colAction'),
            cell: (l) => {
              if (canDispute(l.verdict, l.disputeStatus)) {
                return <Link href={reconHref(inv.id, 'dispute', l.id)} className="kv-link">{t.t('freight.disputeLine')}</Link>;
              }
              if (l.disputeStatus === 'disputed') {
                return <Link href={reconHref(inv.id, 'resolve', l.id)} className="kv-link">{t.t('freight.resolveLine')}</Link>;
              }
              if (l.disputeStatus === 'resolved') {
                return <span className="kv-field__hint">{l.resolvedAt ? formatDate(l.resolvedAt, lang) : t.t('freight.resolvedWord')}</span>;
              }
              const blocked = disputeBlockedKey(l.verdict);
              return blocked ? <span className="kv-field__hint">{t.t(blocked)}</span> : <span className="kv-field__hint">{t.t('common.dash')}</span>;
            },
          },
        ]}
      />

      {/* ---- W242's footing line, computed and only ticked when it actually foots ---- */}
      {footing.lines > 0 && (
        <p className="kv-field__hint">
          {formatNumber(footing.lines, lang)} {t.t('freight.disputedWord')} = {money(footing.billedMinor)}
          {' '}{t.t('freight.vsExpected')} {money(footing.expectedMinor)}
          {' · '}{t.t('freight.variance')} {money(footing.varianceMinor)}
          {' · '}{t.t(footing.foots ? 'freight.foots' : 'freight.footsPartial')}
          {!footing.foots && <> ({formatNumber(footing.expectedKnown, lang)}/{formatNumber(footing.lines, lang)})</>}
        </p>
      )}

      {/* ---- the double-billed consignments, which neither canon screen draws ---- */}
      {detail.duplicates.length > 0 && (
        <div className="kv-error" role="alert">
          <h2>{t.t('freight.dup.heading')}</h2>
          <p>{t.t('freight.dup.lead')} {money(duplicateClaimMinor(detail.duplicates))}</p>
          <ul>
            {detail.duplicates.map((d) => (
              <li key={`${d.awbNo}-${d.otherInvoiceId}`}>
                {d.awbNo}{' · '}
                <Link href={reconHref(d.otherInvoiceId)} className="kv-link">{d.otherInvoiceNo}</Link>
                {' · '}{formatDate(d.periodStart, lang, { month: 'short', year: 'numeric' })}
                {' · '}{money(d.billedMinor)}
              </li>
            ))}
          </ul>
          <p className="kv-field__hint">{t.t('freight.dup.how')}</p>
        </div>
      )}

      {/* ---- W242's "Why we win these", claim by claim, because they are not equally true ---- */}
      <div className="kv-card">
        <h2>{t.t('freight.evidence.heading')}</h2>
        <ul>
          {EVIDENCE_CLAIMS.map((c) => <li key={c}>{t.t(evidenceClaimKey(c))}</li>)}
        </ul>
      </div>

      {/* ---- W242's settlement path: three steps, one of which this platform performs ---- */}
      <div className="kv-card">
        <h2>{t.t('freight.settle.heading')}</h2>
        <ol>
          {SETTLEMENT_STEPS.map((s) => (
            <li key={s}>
              {t.t(settlementKey(s))}
              {!settlementBuilt(s) && <> <span className="kv-badge kv-badge--muted">{t.t('freight.settle.notBuilt')}</span></>}
            </li>
          ))}
        </ol>
        {detail.pack && (
          <p className="kv-field__hint">
            {t.t('freight.pack.ready')} {formatNumber(detail.pack.lines, lang)}
            {' · '}{money(detail.pack.claimedMinor)}
            {' · '}{t.t(packKey(detail.pack.clockKept))} {formatNumber(detail.pack.windowDays, lang)}
          </p>
        )}
        <p className="kv-field__hint">{t.t('freight.recon.perLineAudit')}</p>
      </div>

      {!act && (
        <p className="kv-toolbar">
          {inv.reconStatus === 'pending' && (
            <Link href={reconHref(inv.id, 'reconcile')} className="kv-btn">{t.t('freight.reconcile')}</Link>
          )}
          {(inv.reconStatus === 'variance_open' || inv.reconStatus === 'disputed_lines' || inv.reconStatus === 'pending') && (
            <> <Link href={reconHref(inv.id, 'close')} className="kv-btn--link">{t.t('freight.closeRecon')}</Link></>
          )}
        </p>
      )}
    </section>
  );
}
