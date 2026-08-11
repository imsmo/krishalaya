// modules/tenancy/read-models/billing-tax-rate.ts · the tax rate on a SaaS invoice, resolved from settings (TENANT-1d-2).
//
// 0126 put `billing.tax_bp` in the registry with `risk_class = 'money_path'` and a shipped default of 1800, because W119
// prints "GST 18%" and **18 is an Indian number on a platform that reaches Bangladesh in Y6-7** — a constant would be rule
// zero broken in one line.
//
// **AND THEN NOTHING READ IT.** The setting existed and the proration function took `taxBp` as an argument, but no caller
// resolved one, because no caller existed at all (see plan-change.service.ts for the larger finding).
//
// The two-column resolve is 0121's: a platform override if an administrator set one, the shipped default behind it. Same
// shape as market-intel's anomaly policy, which is the precedent this follows deliberately rather than inventing a second
// way to read a platform setting.
import { Injectable, Logger } from '@nestjs/common';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';

export const TAX_BP_KEY = 'billing.tax_bp';
/** 0126's own shipped default — India GST. Duplicated here as a last resort, never as the normal path. */
export const DEFAULT_TAX_BP = 1800;
const TTL_MS = 60_000;

export interface TaxRate {
  bp: number;
  /** True when no platform override exists, so the shipped default applies. Normal, not an error. */
  usedDefault: boolean;
  /**
   * True when the setting could not be READ at all.
   *
   * **THIS IS THE FLAG THAT STOPS AN INVOICE.** A preview may still render (the tenant learns what the change would cost,
   * with the caveat), but `PlanChangeService.change` refuses to raise an invoice while it is true: a tenant's invoice must
   * not carry a tax figure the platform guessed because a replica was unreachable. A wrong tax line is a filing a finance
   * team cannot defend, and there is no way to un-issue an invoice a tenant has already seen.
   */
  readFailed: boolean;
}

@Injectable()
export class BillingTaxRate {
  private readonly log = new Logger(BillingTaxRate.name);
  private cached: { at: number; rate: TaxRate } | null = null;

  constructor(private readonly pools: PgPoolProvider) {}

  async current(): Promise<TaxRate> {
    if (this.cached && Date.now() - this.cached.at < TTL_MS) return this.cached.rate;
    try {
      const r = await this.pools.replica(0).query<{ value: unknown; is_default: boolean }>(
        `SELECT COALESCE(v.value, d.default_value) AS value, (v.value IS NULL) AS is_default
           FROM setting_definitions d
           LEFT JOIN platform_setting_values v ON v.key = d.key AND v.deleted_at IS NULL
          WHERE d.key = $1`, [TAX_BP_KEY]);
      const row = r.rows[0];
      // **A MISSING DEFINITION IS A READ FAILURE, NOT A ZERO-RATE JURISDICTION.** If the row is absent the migration has
      // not run, and invoicing at 0% tax because a table lookup came back empty is the worst possible interpretation.
      if (!row) {
        this.log.error(`${TAX_BP_KEY} has no definition — 0126 may not be applied; refusing to treat that as tax-free`);
        return this.miss();
      }
      const bp = intFrom(row.value);
      if (bp === null) {
        this.log.error(`${TAX_BP_KEY} is not a usable integer (${JSON.stringify(row.value)}) — refusing to invoice on it`);
        return this.miss();
      }
      const rate: TaxRate = { bp, usedDefault: Boolean(row.is_default), readFailed: false };
      this.cached = { at: Date.now(), rate };
      return rate;
    } catch (err) {
      // Loud: running on a fallback tax rate is a fact an operator should learn from the logs, not from an audit.
      this.log.error(`${TAX_BP_KEY} unreadable: ${(err as Error)?.message ?? err}`);
      return this.miss();
    }
  }

  /** Not cached — a failure must be retried on the next request rather than pinned for a minute. */
  private miss(): TaxRate {
    return { bp: DEFAULT_TAX_BP, usedDefault: true, readFailed: true };
  }
}

/** 0 is a legitimate rate (a zero-rated jurisdiction), so only a non-integer or a negative one is a refusal. */
function intFrom(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > 10_000) return null;
  return Math.floor(n);
}
