// modules/insurance/gateway/pmfby-provider.port.ts
// Port to the EXTERNAL PMFBY (Pradhan Mantri Fasal Bima Yojana) govt crop-insurance portal (DEV-25,
// KV-BL-057, Wave 7). Krishalaya owns the POLICY aggregate (insurance_policies); the govt portal owns
// the actual scheme-enrolment record. NO commercial/govt provider account exists in this environment
// (§8: provider accounts are founder-reviewed before any real credential is set) — the real PMFBY API
// spec is NOT in this repo, so this port's input shape is OUR domain's own fields (what
// InsurancePolicyService already has at hand for a 'crop_season' policy), never an invented govt payload
// shape. A real integration will need at minimum: the farmer's KYC-verified identity, the plot's survey
// number + Bhulekh land record, and the crop/season code — none of which insurance_policies carries today
// (subjectId only names a row in another module's table; this module does not cross-fetch it) — this is
// the DOCUMENTED MAPPING TODO for provider onboarding, stated honestly rather than fabricated.
//
// Adapters are resilience-wrapped and DEGRADE (never throw into the caller) — an unset/unreachable portal
// means "needs manual processing", never a fabricated govt application reference (Law 7/12).
export const PMFBY_PROVIDER = Symbol('PMFBY_PROVIDER');

export interface PmfbyEnrolmentInput {
  idempotencyKey: string;         // = policyId; the govt portal MUST dedup on this (Law 3)
  tenantId: string;
  policyId: string;
  holderUserId: string;           // NEVER a raw Aadhaar/PAN — the adapter has no PII beyond what the caller passes
  productCode: string;            // the product's insurance_kind lookup CODE (e.g. 'pmfby') — resolved from
                                   // insurance_products.product_kind_id -> lookup_values.code by the caller;
                                   // insurance_products itself has no own 'code' column (verified against
                                   // 0011_fintech_schemes.sql — DEV-25 QA-FIX, was previously mis-documented here)
  sumInsuredMinor: string;        // bigint-as-string (Law 2)
  premiumMinor: string;
  validFrom: string;              // 'YYYY-MM-DD'
  validUntil: string;
  /** MAPPING TODO (provider onboarding): crop/survey-number/plot fields the real PMFBY submission form
   *  requires are not yet cross-module-fetched by this batch — left null/undefined honestly rather than
   *  invented. A future batch adds a read-only fetch from land-soil-weather's crop_seasons/plots once the
   *  real PMFBY field-mapping is ratified with the actual portal spec in hand. */
  cropSeasonRef?: string | null;
}

export interface PmfbyEnrolmentResult {
  status: 'submitted' | 'unavailable';
  govtApplicationRef?: string;    // the portal's own application/acknowledgement number
  failureReason?: string;         // present iff status === 'unavailable'
}

export interface PmfbyStatusInput { idempotencyKey: string; tenantId: string; govtApplicationRef: string; }
export interface PmfbyStatusResult {
  status: 'submitted' | 'unavailable';
  portalStatus?: string;          // the portal's own raw status string (opaque, not mapped to our policy_status)
  failureReason?: string;
}

export interface PmfbyProvider {
  readonly providerCode: string;
  /** Submit a crop-season policy's enrolment to the PMFBY portal. Resilience-wrapped; degrades to
   *  {status:'unavailable'} rather than throwing (the caller queues manual processing, never a silent drop). */
  submitEnrolment(input: PmfbyEnrolmentInput): Promise<PmfbyEnrolmentResult>;
  /** Poll the portal for an already-submitted application's status. Same degrade contract. */
  checkStatus(input: PmfbyStatusInput): Promise<PmfbyStatusResult>;
}
