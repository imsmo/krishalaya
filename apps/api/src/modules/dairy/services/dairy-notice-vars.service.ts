// modules/dairy/services/dairy-notice-vars.service.ts · PC-56 TENANT-6d-7 · the I/O half of THE WORDS THAT NEVER
// ARRIVED. The rules are pure in `domain/dairy-notice-vars.ts`; this is the part that reads.
//
// ONE SERVICE RATHER THAN A DEPENDENCY IN EACH EMITTER, and the reason is the defect itself: the six dairy notice
// payloads were assembled at six different keyboards, each next to the entity whose props happened to be in scope, and
// every one of them satisfied the domain and none of them satisfied the copy. A single collaborator that every emitter
// asks — *"what are this notice's variables?"* — is what makes the answer checkable in one spec instead of six.
//
// WHAT IT READS, AND WHY EACH IS A READ AND NOT A CONSTANT:
//   • `ui_messages` (seed 0016) for the words behind an enum — Law 6, and a cooperative that renames its shifts must
//     not need a deploy;
//   • `currencies.minor_units` for money — a hardcoded ÷100 is the shape that blocks a country (rule zero);
//   • `countries.timezone` through the tenant for the one value in these notices that is a deadline;
//   • `lookup_values` (through the lookups module's PUBLIC service, per CLAUDE.md's module rule) for the deduction
//     type names, because *"INR 2,400 was taken"* is not an answer to *"what for?"*.
import { Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { LangMap, PLATFORM_LANGS } from '../../../core/i18n/lang-map';
import { LookupsService } from '../../lookups/lookups.service';
import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { MilkShift } from '../domain/dairy.events';
import {
  DairyNoticeLabels, Money, billConsentVars, billDisputeResolvedVars, billPreviewedVars,
  deductionInstructionVars, qualityDecidedVars, qualityOpenedVars,
} from '../domain/dairy-notice-vars';

/** The tenant facts a money-or-deadline notice cannot be worded without. */
export interface TenantMoneyContext { timezone: string; minorUnits: number; }

const SHIFT_KEYS: Record<MilkShift, string> = { morning: 'dairy.shift.morning', evening: 'dairy.shift.evening' };
const QUALITY_KEYS = { cleared: 'dairy.quality.outcome.cleared', rejected: 'dairy.quality.outcome.rejected' } as const;
const DISPUTE_KEYS = { upheld: 'dairy.dispute.outcome.upheld', rejected: 'dairy.dispute.outcome.rejected' } as const;

@Injectable()
export class DairyNoticeVarsService {
  /** `ui_messages` has no tenant column and changes only on deploy, so one read per process is honest caching. */
  private labelsCache: DairyNoticeLabels | null = null;

  constructor(
    private readonly ui: UiMessageRepository,
    private readonly lookups: LookupsService,
    private readonly centres: MccCentreRepository,
  ) {}

  /**
   * The words. **FAILS CLOSED**: `langMapFrom` throws when the platform holds no English text for a key, so a
   * deployment that skipped seed 0016 cannot quietly send *"your milk at  is held for a  check"* — it raises, the act
   * that was going to notify somebody fails loudly, and a human fixes the seed. That is the opposite of the behaviour
   * this wave exists to remove: `render()` turning a missing value into an empty string, for ever, in silence.
   */
  async labels(x?: TxContext): Promise<DairyNoticeLabels> {
    if (this.labelsCache) return this.labelsCache;
    const maps = await this.ui.mapsUnder('dairy.', x);
    const need = (key: string): LangMap => {
      const m = maps.get(key);
      if (!m) throw new Error(`dairy notice: ui_messages has no '${key}' — seed db/seeds/core/0016 is missing`);
      return m;
    };
    const labels: DairyNoticeLabels = {
      shift: { morning: need(SHIFT_KEYS.morning), evening: need(SHIFT_KEYS.evening) },
      qualityOutcome: { cleared: need(QUALITY_KEYS.cleared), rejected: need(QUALITY_KEYS.rejected) },
      disputeOutcome: { upheld: need(DISPUTE_KEYS.upheld), rejected: need(DISPUTE_KEYS.rejected) },
    };
    this.labelsCache = labels;
    return labels;
  }

  /** The tenant's own clock and the currency's own scale, in one read. */
  async moneyContext(x: TxContext, tenantId: string, currencyCode: string): Promise<TenantMoneyContext> {
    const r = await x.query<{ timezone: string; minor_units: number | null }>(
      `SELECT co.timezone, cu.minor_units
         FROM tenants t
         JOIN countries co ON co.code = t.country_code
         LEFT JOIN currencies cu ON cu.code = upper($2)
        WHERE t.id = $1`, [tenantId, currencyCode]);
    const row = r.rows[0];
    if (!row) throw new Error(`dairy notice: tenant ${tenantId} has no country, so no timezone`);
    if (row.minor_units === null || row.minor_units === undefined) {
      // Rule zero, stated as an error rather than an assumption: a currency this platform holds no scale for cannot be
      // divided, and guessing two decimals is how a JPY or KWD cooperative gets a bill wrong by a factor of a hundred.
      throw new Error(`dairy notice: currencies has no minor_units for ${currencyCode}`);
    }
    return { timezone: row.timezone, minorUnits: row.minor_units };
  }

  /**
   * THE TENANT'S OWN CURRENCY, when the aggregate does not carry one — `dairy_deduction_instructions.max_per_cycle_minor`
   * is an amount with no currency column, so the arrangement's ceiling can only be worded against the cooperative's
   * currency. Read from `countries.currency_code` through the tenant, with NO `?? 'INR'`: the platform's other reader of
   * this fact defaults to INR when the join misses, and a default currency is the shape that quietly makes a
   * cross-border deployment wrong about money. Fail closed instead.
   */
  async tenantMoneyContext(x: TxContext, tenantId: string): Promise<TenantMoneyContext & { currencyCode: string }> {
    const r = await x.query<{ timezone: string; currency_code: string; minor_units: number | null }>(
      `SELECT co.timezone, co.currency_code, cu.minor_units
         FROM tenants t
         JOIN countries co ON co.code = t.country_code
         LEFT JOIN currencies cu ON cu.code = co.currency_code
        WHERE t.id = $1`, [tenantId]);
    const row = r.rows[0];
    if (!row) throw new Error(`dairy notice: tenant ${tenantId} has no country, so no currency and no timezone`);
    if (row.minor_units === null || row.minor_units === undefined) {
      throw new Error(`dairy notice: currencies has no minor_units for ${row.currency_code}`);
    }
    return { timezone: row.timezone, minorUnits: row.minor_units, currencyCode: row.currency_code };
  }

  private money(minor: bigint, currencyCode: string, ctx: TenantMoneyContext): Money {
    return { minor, currencyCode, minorUnits: ctx.minorUnits };
  }

  // ---- W168 · the quality flag ---------------------------------------------------------------------------------
  async qualityOpened(x: TxContext, tenantId: string, i: { mccId: string; shift: MilkShift }) {
    const [labels, centre] = await Promise.all([this.labels(x), this.centres.getById(tenantId, i.mccId, x).catch(() => null)]);
    // A centre that cannot be read is named by nothing rather than by a UUID: a farmer reading *"your milk at
    // 7f3c-…-91 is held"* learns less than one reading *"your milk is held"*, and the id would also leak an internal
    // key into an SMS. The blank is deliberate HERE and only here, and it is the one case the guard spec allows.
    const props = centre?.toProps() ?? null;
    return qualityOpenedVars({ mccName: props ? props.defaultName : '', shift: i.shift, labels });
  }

  async qualityDecided(x: TxContext, i: { outcome: 'cleared' | 'rejected' }) {
    return qualityDecidedVars({ outcome: i.outcome, labels: await this.labels(x) });
  }

  // ---- W169 · the bill, the objection, the consent -------------------------------------------------------------
  async billPreviewed(x: TxContext, tenantId: string, i: {
    periodStart: string; periodEnd: string; totalLitresMilli: bigint; netMinor: bigint; deductionsMinor: bigint;
    windowEndsAt: Date;
  }) {
    // A `milk_bills` row carries no currency column — the cooperative's own currency is the bill's currency — so the
    // notice reads it from the tenant rather than from a constant. (The platform's other reader of this fact falls back
    // to `'INR'`; see `tenantMoneyContext` for why this one refuses to.)
    const ctx = await this.tenantMoneyContext(x, tenantId);
    const currencyCode = ctx.currencyCode;
    return billPreviewedVars({
      periodStart: i.periodStart, periodEnd: i.periodEnd, totalLitresMilli: i.totalLitresMilli,
      net: this.money(i.netMinor, currencyCode, ctx), deductions: this.money(i.deductionsMinor, currencyCode, ctx),
      windowEndsAt: i.windowEndsAt, timezone: ctx.timezone,
    });
  }

  async billDisputeResolved(x: TxContext, i: {
    periodStart: string; periodEnd: string; outcome: 'upheld' | 'rejected'; note: string;
  }) {
    return billDisputeResolvedVars({ ...i, labels: await this.labels(x) });
  }

  async billConsent(x: TxContext, tenantId: string, i: {
    periodStart: string; periodEnd: string; grossMinor: bigint; deductionsMinor: bigint;
    thresholdPct: number; lines: ReadonlyArray<{ typeCode: string; amountMinor: bigint }>;
  }) {
    const ctx = await this.tenantMoneyContext(x, tenantId);
    const currencyCode = ctx.currencyCode;
    const names = await this.deductionTypeLabels(tenantId);
    return billConsentVars({
      periodStart: i.periodStart, periodEnd: i.periodEnd,
      gross: this.money(i.grossMinor, currencyCode, ctx),
      deductions: this.money(i.deductionsMinor, currencyCode, ctx),
      thresholdPct: i.thresholdPct,
      lines: i.lines.map((l) => ({
        name: names.get(l.typeCode) ?? { en: l.typeCode },
        amount: this.money(l.amountMinor, currencyCode, ctx),
      })),
    });
  }

  // ---- W169 · the standing instruction -------------------------------------------------------------------------
  async deductionInstruction(x: TxContext, tenantId: string, i: { typeCode: string; maxPerCycleMinor: bigint | null }) {
    const names = await this.deductionTypeLabels(tenantId);
    const what = names.get(i.typeCode) ?? { en: i.typeCode };
    if (i.maxPerCycleMinor === null) return deductionInstructionVars({ what, maxPerCycle: null });
    const ctx = await this.tenantMoneyContext(x, tenantId);
    return deductionInstructionVars({ what, maxPerCycle: this.money(i.maxPerCycleMinor, ctx.currencyCode, ctx) });
  }

  /**
   * The deduction vocabulary in every launch language, from `lookup_values` + `translations` through the lookups
   * module's own service — which already resolves a name per language and caches it, so this is three cached reads and
   * not a second copy of that query. A code with no translation falls back to its canonical `default_name` inside that
   * service, which is the graceful answer: an English label beats an empty space where the reason for a deduction was.
   */
  private async deductionTypeLabels(tenantId: string): Promise<Map<string, LangMap>> {
    const perLang = await Promise.all(PLATFORM_LANGS.map(async (lang) => ({
      lang, values: await this.lookups.values(tenantId, lang, 'milk_deduction'),
    })));
    const out = new Map<string, LangMap>();
    for (const { lang, values } of perLang) {
      for (const v of values) {
        const cur = out.get(v.code) ?? { en: v.name };
        cur[lang] = v.name;
        out.set(v.code, cur);
      }
    }
    return out;
  }
}
