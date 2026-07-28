// modules/insurance/domain/insurance-product.entity.ts · read-only VO for insurance_products.
// GLOBAL reference data (no tenant_id), admin/platform-authored (Law 11) — this module only READS it, mirrors
// modules/fintech/domain/loan-product.entity.ts exactly. Money fields are bigint minor units (Law 2); this
// table (like loan_products before insurance existed) intentionally carries no currency_code column of its
// own — see insurance-policy.entity.ts's header note on the shared, already-ratified Law-2 debt.
import { PremiumCalc, parsePremiumCalc } from './premium-calc';

export interface InsuranceProductProps {
  id: string;
  partnerId: string;
  productKindId: string;      // lookup_values 'insurance_kind': pmfby|wbcis|cattle|poultry|equipment|polyhouse|pmsby|pmjjby|health|term|parametric_weather
  defaultName: string;
  premiumCalcRaw: unknown;    // raw jsonb; parsed on demand via premiumCalc()
  sumInsuredRules: Record<string, unknown>;
  govtSubsidyBps: number;
  ourCommissionBps: number;
  isParametric: boolean;
  isActive: boolean;
  createdAt?: Date;
}

export class InsuranceProduct {
  private constructor(private readonly props: InsuranceProductProps) {}
  static rehydrate(p: InsuranceProductProps): InsuranceProduct { return new InsuranceProduct(p); }

  get id() { return this.props.id; }
  get partnerId() { return this.props.partnerId; }
  get govtSubsidyBps() { return this.props.govtSubsidyBps; }
  get isActive() { return this.props.isActive; }
  get isParametric() { return this.props.isParametric; }

  /** Parses the raw jsonb premium_calc into a typed shape; throws InvalidPremiumCalcError if malformed. */
  premiumCalc(): PremiumCalc { return parsePremiumCalc(this.props.premiumCalcRaw); }

  toJSON() {
    const v = this.props;
    return {
      id: v.id, partnerId: v.partnerId, productKindId: v.productKindId, name: v.defaultName,
      sumInsuredRules: v.sumInsuredRules, govtSubsidyBps: v.govtSubsidyBps, ourCommissionBps: v.ourCommissionBps,
      isParametric: v.isParametric, isActive: v.isActive,
      // premium_calc rendered as-is (raw jsonb) for client display; server-side computation always re-parses
      // via premiumCalc() rather than trusting a client-echoed value (money-safety).
      premiumCalc: v.premiumCalcRaw,
    };
  }
}
