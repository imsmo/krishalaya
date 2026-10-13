// apps/web-storefront/src/features/chain/mask.ts · PC-56 STORE-1a PORT of `maskForDisplay` from apps/web-tenant/src/features/signup/steps.ts —
// the function below is byte-identical to that one (drift-tested by src/test/chain-drift.spec.ts). Canon W322: "Sent by SMS to +91 98••• ••742".

/**
 * W113's masked confirmation line: "6-digit code sent to +91 99••• ••482".
 *
 * Masked even though the person just typed it, because this page is shown on a shared phone at an MCC counter as often as
 * on a private one — and the same five-of-ten policy every other screen uses (W153, W109) is the one a reader recognises.
 */
export function maskForDisplay(raw: string): string {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 6) return '••••';
  const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
  const local = digits.slice(-10);
  return `${cc ? `+${cc} ` : ''}${local.slice(0, 2)}••• ••${local.slice(-3)}`;
}
