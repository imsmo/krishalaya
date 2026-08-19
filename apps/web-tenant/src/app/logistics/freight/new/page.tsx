// apps/web-tenant/src/app/logistics/freight/new/page.tsx · W241's [Upload carrier invoice] and the four chain
// states the canon requires of every form (PC-56 TENANT-5c): W2612 form-error · W2613 review · W2614 success ·
// W2615 failure. Server-first, requireSession-gated, noindex, no client JS — the step rides in the URL, so Back
// works and a 40-line paste survives a dropped signal.
//
// THE FORM'S OWN HONESTY:
//   • **the invoice document is not read.** W241 calls the action "Upload carrier invoice"; a carrier's invoice
//     arrives as a PDF or a CSV, and this platform has no table extractor. Accepting a PDF and pretending to have
//     parsed it would put invented lines into a money reconciliation — the worst possible failure on this screen. So
//     the document is attached as EVIDENCE (a `media_assets` row, the same rules as any other upload) and the lines
//     are pasted or keyed, which the form says out loud;
//   • **amounts are minor units, end to end.** A field that accepted "964.40" and multiplied by 100 in the browser
//     would have done money arithmetic in a float, which is the one thing Law 2 exists to prevent. The hint says
//     paise and the review step shows the formatted total, so a wrong magnitude is visible BEFORE anything is saved;
//   • **the lines must sum to the header.** Enforced here, in the review step, and again by the entity server-side.
//     An upload that lost a line manufactures a "variance" that is our own transcription error wearing the carrier's
//     coat — and telling those two apart is the entire purpose of this desk;
//   • and **recording a bill reconciles nothing.** W2613's review step says so, because an operator who believes the
//     upload checked the invoice will never press Reconcile, and the leakage will sit there quietly.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import {
  DEFAULT_FREIGHT_CURRENCY, MAX_FREIGHT_LINES, documentNoticeKey, errorFor, freightErrorKey, linesTotalMinor,
  parseLines, reviewNoticeKey, validateDraft, type FreightDraft,
} from '../../../../features/logistics/freight';
import type { LogisticsPartnerRow } from '@krishalaya/sdk-js';
import { recordFreightInvoiceAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('freight.form.title'), robots: { index: false, follow: false } };
}

export default async function NewFreightInvoicePage({ searchParams }: {
  searchParams: {
    step?: string; carrierId?: string; invoiceNo?: string; sourceKind?: string; periodStart?: string;
    periodEnd?: string; billedMinor?: string; currencyCode?: string; linesRaw?: string; invalid?: string; error?: string;
  };
}) {
  await requireSession('/logistics/freight/new');
  const t = getTranslator();
  const lang = getLang();

  const draft: FreightDraft = {
    carrierId: searchParams.carrierId ?? '',
    invoiceNo: searchParams.invoiceNo ?? '',
    sourceKind: searchParams.sourceKind === 'own_fleet_cost_note' ? 'own_fleet_cost_note' : 'carrier_invoice',
    periodStart: searchParams.periodStart ?? '',
    periodEnd: searchParams.periodEnd ?? '',
    billedMinor: searchParams.billedMinor ?? '',
    currencyCode: (searchParams.currencyCode ?? DEFAULT_FREIGHT_CURRENCY).toUpperCase(),
    linesRaw: searchParams.linesRaw ?? '',
  };
  const review = searchParams.step === 'review';
  // Validated on THIS render, never trusted from the URL: a link carrying `step=review` must not skip validation.
  const errors = review || searchParams.invalid ? validateDraft(draft) : [];
  const errKey = searchParams.error ? freightErrorKey(searchParams.error) : null;

  // The carriers on offer are this tenant's own logistics partners — including the `tenant_fleet` row, which is what
  // an own-fleet cost note is billed against (W241's third row: "Own fleet · internal cost note · fuel + wages").
  let partners: LogisticsPartnerRow[] = [];
  try {
    partners = await tenantClient().fleet.listPartners({ activeOnly: true, limit: 100 });
  } catch { partners = []; }
  const nameOf = (id: string) => partners.find((p) => p.id === id)?.defaultName ?? id.slice(0, 8);

  const parsed = parseLines(draft.linesRaw);

  return (
    <section>
      <h1>{t.t('freight.form.title')}</h1>
      <p className="kv-field__hint">
        <Link href="/logistics/freight" className="kv-link">{t.t('freight.backToDesk')}</Link>
      </p>

      {/* W2615: the attempt was rejected and state is untouched — the reason, then a retry path. */}
      {errKey && (
        <div className="kv-error" role="alert">
          <p>{t.t('freight.form.failureTitle')}</p>
          <p>{t.t(errKey)}</p>
          <p>{t.t('freight.form.failureUntouched')}</p>
        </div>
      )}

      {/* W2612: every invalid field listed with its reason; the values entered are preserved. */}
      {errors.length > 0 && (
        <div className="kv-error" role="alert">
          <p>{t.t('freight.form.errorTitle')}</p>
          <ul>{errors.map((e) => <li key={e.field}>{t.t(e.key)}</li>)}</ul>
        </div>
      )}

      {review && errors.length === 0 ? (
        /* ---- W2613: review, read-only, before anything is written ---- */
        <form action={recordFreightInvoiceAction} className="kv-card">
          <h2>{t.t('freight.form.reviewTitle')}</h2>
          <p className="kv-card kv-card--notice" role="status">{t.t(reviewNoticeKey())}</p>
          <dl>
            <dt>{t.t('freight.form.carrier')}</dt><dd>{nameOf(draft.carrierId)}</dd>
            <dt>{t.t('freight.form.invoiceNo')}</dt><dd>{draft.invoiceNo.trim()}</dd>
            <dt>{t.t('freight.form.sourceKind')}</dt><dd>{t.t(`freight.source.${draft.sourceKind}`)}</dd>
            <dt>{t.t('freight.form.period')}</dt><dd>{draft.periodStart} – {draft.periodEnd}</dd>
            <dt>{t.t('freight.form.billed')}</dt>
            {/* The formatted total, so a paise/rupee mix-up is visible while it is still free to fix. */}
            <dd>{formatMoneyMinor(draft.billedMinor, draft.currencyCode, lang)} <span className="kv-field__hint">({draft.billedMinor})</span></dd>
            <dt>{t.t('freight.form.lines')}</dt>
            <dd>
              {formatNumber(parsed.lines.length, lang)}
              {' · '}{formatMoneyMinor(linesTotalMinor(parsed.lines), draft.currencyCode, lang)}
            </dd>
          </dl>
          <input type="hidden" name="carrierId" value={draft.carrierId} />
          <input type="hidden" name="invoiceNo" value={draft.invoiceNo} />
          <input type="hidden" name="sourceKind" value={draft.sourceKind} />
          <input type="hidden" name="periodStart" value={draft.periodStart} />
          <input type="hidden" name="periodEnd" value={draft.periodEnd} />
          <input type="hidden" name="billedMinor" value={draft.billedMinor} />
          <input type="hidden" name="currencyCode" value={draft.currencyCode} />
          <input type="hidden" name="linesRaw" value={draft.linesRaw} />
          <button type="submit" className="kv-btn">{t.t('freight.form.submit')}</button>{' '}
          <Link
            href={`/logistics/freight/new?${new URLSearchParams({
              carrierId: draft.carrierId, invoiceNo: draft.invoiceNo, sourceKind: draft.sourceKind,
              periodStart: draft.periodStart, periodEnd: draft.periodEnd, billedMinor: draft.billedMinor,
              currencyCode: draft.currencyCode, linesRaw: draft.linesRaw,
            }).toString()}`}
            className="kv-btn--link"
          >
            {t.t('freight.form.backToEdit')}
          </Link>
        </form>
      ) : (
        /* ---- the form itself. GET → the review step, so nothing is written before the read-only check ---- */
        <form method="get" action="/logistics/freight/new" className="kv-card">
          <input type="hidden" name="step" value="review" />

          <label className="kv-field__label" htmlFor="f-carrier">{t.t('freight.form.carrier')}</label>
          <select id="f-carrier" name="carrierId" className="kv-input" defaultValue={draft.carrierId} required
                  aria-invalid={!!errorFor(errors, 'carrierId')}>
            <option value="">{t.t('common.dash')}</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.defaultName}</option>)}
          </select>
          {errorFor(errors, 'carrierId') && <p className="kv-error">{t.t(errorFor(errors, 'carrierId')!)}</p>}
          {partners.length === 0 && <p className="kv-field__hint">{t.t('freight.form.noCarriers')}</p>}

          <label className="kv-field__label" htmlFor="f-kind">{t.t('freight.form.sourceKind')}</label>
          <select id="f-kind" name="sourceKind" className="kv-input" defaultValue={draft.sourceKind}>
            <option value="carrier_invoice">{t.t('freight.source.carrier_invoice')}</option>
            <option value="own_fleet_cost_note">{t.t('freight.source.own_fleet_cost_note')}</option>
          </select>
          <p className="kv-field__hint">{t.t('freight.form.costNoteHint')}</p>

          <label className="kv-field__label" htmlFor="f-no">{t.t('freight.form.invoiceNo')}</label>
          <input id="f-no" name="invoiceNo" className="kv-input" maxLength={60} defaultValue={draft.invoiceNo}
                 aria-invalid={!!errorFor(errors, 'invoiceNo')} required />
          {errorFor(errors, 'invoiceNo') && <p className="kv-error">{t.t(errorFor(errors, 'invoiceNo')!)}</p>}

          <label className="kv-field__label" htmlFor="f-from">{t.t('freight.form.periodStart')}</label>
          <input id="f-from" name="periodStart" type="date" className="kv-input" defaultValue={draft.periodStart}
                 aria-invalid={!!errorFor(errors, 'periodStart')} required />
          {errorFor(errors, 'periodStart') && <p className="kv-error">{t.t(errorFor(errors, 'periodStart')!)}</p>}

          <label className="kv-field__label" htmlFor="f-to">{t.t('freight.form.periodEnd')}</label>
          <input id="f-to" name="periodEnd" type="date" className="kv-input" defaultValue={draft.periodEnd}
                 aria-invalid={!!errorFor(errors, 'periodEnd')} required />
          {errorFor(errors, 'periodEnd') && <p className="kv-error">{t.t(errorFor(errors, 'periodEnd')!)}</p>}

          <label className="kv-field__label" htmlFor="f-billed">{t.t('freight.form.billed')}</label>
          <input id="f-billed" name="billedMinor" className="kv-input" inputMode="numeric" pattern="\d{1,18}"
                 defaultValue={draft.billedMinor} aria-invalid={!!errorFor(errors, 'billedMinor')} required />
          <p className="kv-field__hint">{t.t('freight.form.minorHint')}</p>
          {errorFor(errors, 'billedMinor') && <p className="kv-error">{t.t(errorFor(errors, 'billedMinor')!)}</p>}

          {/* Asked for rather than assumed: the column and the DTO both accept any ISO code, and a form that
              stamped every bill INR would quietly cap this desk to one country's carriers. */}
          <label className="kv-field__label" htmlFor="f-cur">{t.t('freight.form.currency')}</label>
          <input id="f-cur" name="currencyCode" className="kv-input" maxLength={3} size={3}
                 defaultValue={draft.currencyCode || DEFAULT_FREIGHT_CURRENCY}
                 aria-invalid={!!errorFor(errors, 'currencyCode')} required />
          <p className="kv-field__hint">{t.t('freight.form.currencyHint')}</p>
          {errorFor(errors, 'currencyCode') && <p className="kv-error">{t.t(errorFor(errors, 'currencyCode')!)}</p>}

          <label className="kv-field__label" htmlFor="f-lines">{t.t('freight.form.lines')}</label>
          <textarea id="f-lines" name="linesRaw" className="kv-input" rows={8} defaultValue={draft.linesRaw}
                    aria-invalid={!!errorFor(errors, 'linesRaw')} placeholder={t.t('freight.form.linesPlaceholder')} />
          <p className="kv-field__hint">
            {t.t('freight.form.linesHint')} {t.t('freight.form.linesMax')} {formatNumber(MAX_FREIGHT_LINES, lang)}
          </p>
          {parsed.errors.length > 0 && (
            <p className="kv-error">{t.t('freight.form.lineNumbers')} {parsed.errors.slice(0, 10).map((n) => formatNumber(n, lang)).join(', ')}</p>
          )}
          {errorFor(errors, 'linesRaw') && <p className="kv-error">{t.t(errorFor(errors, 'linesRaw')!)}</p>}

          <p className="kv-field__hint">{t.t(documentNoticeKey())}</p>

          <button type="submit" className="kv-btn">{t.t('freight.form.review')}</button>{' '}
          <Link href="/logistics/freight" className="kv-btn--link">{t.t('freight.form.cancel')}</Link>
        </form>
      )}
    </section>
  );
}
