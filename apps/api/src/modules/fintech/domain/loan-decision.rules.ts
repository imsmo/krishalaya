// modules/fintech/domain/loan-decision.rules.ts · PC-56 PARTNER-0 · founder D3 — WHO MAY DECIDE A LOAN APPLICATION. Pure.
//
// THE PRODUCT-OWNER RULE (survey F-2), read against how `loan_products.partner_id` is used today: it is NOT NULL (0011) — EVERY product names
// a financial partner, and no tenant has a "lending identity" of its own (no tenant → financial_partners link exists). So the rule cannot be
// "a tenant decides its own products"; it is, exactly:
//
//   • a PARTNER actor (the partner console, realm 'partner') decides only applications on ITS OWN products (product.partner_id = the token's
//     partner) — anything else is answered as NOT FOUND (the 404 shape: the realm is not an existence oracle). Consent is checked before this,
//     on the kv_partner axis (0225's `partner_owns_application`), so a partner never reaches this line for an application it cannot read;
//   • a TENANT actor (the FPO's banker / tenant_admin holding `loan.manage`) may review / approve / reject ONLY when the product's partner has
//     NO active console members (0225's `partner_has_console_members`). The day a partner runs its own console, ITS people decide ITS
//     applications and the FPO's staff are refused BY NAME (LOAN_DECIDED_BY_PARTNER). The tenant console's own lending screens are untouched:
//     for a partner without console members nothing changes.
//   • DISBURSE is not a decision and is not covered by this rule: it moves the FPO's wallet money (Law 2 — the FPO is the lender of record in
//     Phase 1), so it stays the FPO's act in the tenant realm, and the partner realm refuses it by name (PARTNER_CANNOT_DISBURSE, in the
//     partner-console module) — an application can only reach `approved` through whoever this rule lets decide.
export type DecisionVerdict = 'allowed' | 'not_found' | 'decided_by_partner';

export function decisionVerdict(input: { actorPartnerId: string | null; productPartnerId: string; partnerHasConsole: boolean }): DecisionVerdict {
  if (input.actorPartnerId) return input.actorPartnerId === input.productPartnerId ? 'allowed' : 'not_found';
  return input.partnerHasConsole ? 'decided_by_partner' : 'allowed';
}
