// modules/tenancy/read-models/billing-console.read-model.ts · W120 (Billing) in ONE tenant-bound read
// (PC-56 TENANT-4d-2).
//
// THE FINDING THIS SERVES: `SaasInvoiceService.list` and `.getById` have existed since TENANT-1, gated on
// `tenant.settings`, returning a tenant's own SaaS invoices — and there is NO ROUTE to either of them anywhere
// in apps/api. A read service with no controller is not a feature; it is a table with no reader. So a tenant has
// never been able to see a bill this platform raised to it, while W120 shows an open balance, an invoice list,
// four tab counts and a year-to-date total.
//
// Every figure here is DERIVED from stored facts by domain/saas-invoice-balance.ts — the same functions the
// payment consumer uses to move an invoice — so the number a tenant reads and the number the platform acts on
// cannot diverge. Nothing on this screen is computed twice.
import { Injectable } from '@nestjs/common';
import { SaasInvoiceRepository } from '../repositories/saas-invoice.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import {
  InvoiceFigures, INVOICE_TABS, gstinLine, maskGstin, openBalance, paidToDate,
  taxLine, timeliness,
} from '../domain/saas-invoice-balance';
// PC-56 TENANT-4d-4: the four mechanism verdicts are DERIVED from what is switched on, not constants.
import { MechanismVerdict, graceAdvice, graceDaysLeft, mechanismLines } from '../domain/billing-grace';

export interface BillingConsoleView {
  /** The open balance, or null with the currencies named where the open invoices are not all in one currency —
   *  a single figure would then be an FX rate this platform did not have (Law 2). */
  openBalanceMinor: string | null;
  openBalanceCurrency: string;
  openBalanceCurrencies: string[];
  openInvoiceCount: number;
  /** True when there are more open invoices than the read is bounded to. Stated, never silently truncated. */
  openBalancePartial: boolean;
  /** The single oldest-due open invoice — W120's headline row. */
  oldestOpen: {
    id: string; invoiceNo: string; status: string; dueDate: string; outstandingMinor: string; currencyCode: string;
    description: string; taxLine: 'stated' | 'zero_rated' | 'not_recorded'; taxBp: number | null; taxMinor: string;
  } | null;
  paidToDate: {
    year: number; minor: string; currencyCode: string; invoiceCount: number;
    onTime: number; late: number; unknown: number; allOnTime: boolean; mixedCurrencies: string[];
  };
  /** W120's tabs, counted from the tenant's own invoices. `issued` groups `partially_paid` (a part-paid invoice
   *  is still awaiting payment and W120 has no fifth tab) — the row keeps its own badge, so nothing is lost. */
  tabCounts: Record<string, number>;
  /** The billed identity, masked for display exactly as W120 renders it, taken from the SNAPSHOT on the most
   *  recent invoice — never from the tenant's current profile, which would re-address history. */
  billTo: { gstinMasked: string | null; legalName: string | null; source: 'snapshot' | 'not_on_invoice' };
  /** The subscription context W120 shows above the invoices. */
  subscription: { id: string; status: string; billingCycle: string; priceMinor: string; currencyCode: string; currentPeriodEnd: string | null; graceUntil: string | null } | null;
  /** The four mechanism sentences W120 states, each with the verdict the code can support. See the type. */
  mechanism: { autopay: MechanismVerdict; nextDebit: MechanismVerdict; gracePeriod: MechanismVerdict; retryAndNotify: MechanismVerdict };
  /** PC-56 TENANT-4d-4 · W120's footnote, as this tenant's actual situation. `inGrace` is the state the
   *  canon calls "service continues"; `daysLeft` is what the tenant needs to know; `advice` is what they can
   *  DO about it — which is to pay the open invoice, NOT to wait for a retry that does not exist. */
  grace: { inGrace: boolean; graceUntil: string | null; daysLeft: number; advice: 'pay_open_invoice' | 'contact_platform' | 'none' };
  /** Whether a tenant may pay its own invoices at all right now (the flag), so the screen can withhold the
   *  button with a reason instead of showing one that refuses. */
  selfPayEnabled: boolean;
}

const OPEN_LIMIT = 200;
const PAID_LIMIT = 500;

@Injectable()
export class BillingConsoleReadModel {
  constructor(private readonly invoices: SaasInvoiceRepository, private readonly subs: SubscriptionRepository) {}

  async view(tenantId: string, now: Date, selfPayEnabled: boolean, flags: { graceEnabled: boolean; cadenceEnabled: boolean } = { graceEnabled: false, cadenceEnabled: false }): Promise<BillingConsoleView> {
    const year = now.getUTCFullYear();
    const [openRows, paidRows, tabRaw, sub] = await Promise.all([
      this.invoices.openInvoices(tenantId, OPEN_LIMIT),
      this.invoices.paidInYear(tenantId, year, PAID_LIMIT),
      this.invoices.countsByStatus(tenantId),
      this.subs.findLiveForTenant(null, tenantId),
    ]);

    const openPartial = openRows.length > OPEN_LIMIT;
    const open = openRows.slice(0, OPEN_LIMIT);
    const paid = paidRows.slice(0, PAID_LIMIT);

    const figs = (rows: typeof open): InvoiceFigures[] => rows.map((i) => {
      const p = i.toProps();
      return { status: p.status, totalMinor: p.totalMinor, paidMinor: p.paidMinor, dueDate: p.dueDate, paidAt: p.paidAt, currencyCode: p.currencyCode };
    });

    const bal = openBalance(figs(open));
    const ptd = paidToDate(figs(paid), year);

    // `openInvoices` is ordered by due_date ASC, so the first row IS the oldest-due — W120's headline.
    const first = open[0]?.toProps() ?? null;
    const oldestOpen = first ? {
      id: first.id, invoiceNo: first.invoiceNo, status: first.status, dueDate: first.dueDate,
      outstandingMinor: (first.totalMinor - first.paidMinor > 0n ? first.totalMinor - first.paidMinor : 0n).toString(),
      currencyCode: first.currencyCode,
      // The description is the invoice's OWN first line, not a sentence this read-model composes: W120 shows
      // "Growth → Professional upgrade proration", which only the invoice knows.
      description: first.lineItems[0]?.desc ?? '',
      taxLine: taxLine(first.taxBp, first.taxMinor), taxBp: first.taxBp, taxMinor: first.taxMinor.toString(),
    } : null;

    // The snapshot comes from the most recently CREATED invoice, open or paid, because that is the identity we
    // last billed under. A tenant with no invoices at all has no snapshot, and says so.
    const newest = [...open, ...paid].map((i) => i.toProps())
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0] ?? null;

    const subP = sub?.toProps() ?? null;

    return {
      openBalanceMinor: 'minor' in bal && bal.minor !== null ? bal.minor.toString() : null,
      openBalanceCurrency: 'currencyCode' in bal ? bal.currencyCode : '',
      openBalanceCurrencies: 'currencies' in bal ? bal.currencies : [],
      openInvoiceCount: 'invoiceCount' in bal ? bal.invoiceCount : open.length,
      openBalancePartial: openPartial,
      oldestOpen,
      paidToDate: { ...ptd, minor: ptd.minor.toString() },
      tabCounts: tabCounts(tabRaw),
      billTo: {
        gstinMasked: maskGstin(newest?.billToGstin ?? null),
        legalName: newest?.billToLegalName ?? null,
        source: gstinLine(newest?.billToGstin ?? null),
      },
      subscription: subP ? {
        id: subP.id, status: subP.status, billingCycle: subP.billingCycle, priceMinor: subP.priceMinor.toString(),
        currencyCode: subP.currencyCode,
        currentPeriodEnd: subP.currentPeriodEnd ? new Date(subP.currentPeriodEnd).toISOString().slice(0, 10) : null,
        graceUntil: subP.graceUntil ?? null,
      } : null,
      mechanism: mechanismLines(flags),
      grace: (() => {
        const gu = subP?.graceUntil ?? null;
        const inGrace = subP?.status === 'past_due' && gu !== null && graceDaysLeft(gu, now) >= 0 && gu >= now.toISOString().slice(0, 10);
        return { inGrace, graceUntil: gu, daysLeft: graceDaysLeft(gu, now), advice: graceAdvice({ inGrace, selfPayEnabled }) };
      })(),
      selfPayEnabled,
    };
  }

  /** Per-invoice timeliness, exposed so the list screen can label a paid row without re-deriving the rule. */
  timelinessOf(r: Pick<InvoiceFigures, 'status' | 'paidAt' | 'dueDate'>) { return timeliness(r); }
}

/** W120's four tabs plus the raw per-status counts behind them, so a screen can show "Issued 1" and a row can
 *  still say "partially paid". `void` is counted but has no tab (see domain/saas-invoice-balance.ts). */
function tabCounts(raw: Record<string, number>): Record<string, number> {
  const n = (k: string) => raw[k] ?? 0;
  const out: Record<string, number> = {
    all: Object.values(raw).reduce((a, b) => a + b, 0),
    issued: n('issued') + n('partially_paid'),
    paid: n('paid'),
    overdue: n('overdue'),
  };
  for (const [k, v] of Object.entries(raw)) out[`status_${k}`] = v;
  // A tab the console will render must exist in the map even at zero, or "Overdue" would vanish rather than
  // read "Overdue 0" — and a missing tab is indistinguishable from a tab nobody may see.
  for (const t of INVOICE_TABS) if (out[t] === undefined) out[t] = 0;
  return out;
}
