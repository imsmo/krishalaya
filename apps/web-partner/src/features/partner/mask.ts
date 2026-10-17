// apps/web-partner/src/features/partner/mask.ts · PC-56 PARTNER-0 — a phone shown back to its owner on the sign-in page: six bullets and the
// last 3 digits (the API's `••••••318` shape). PURE. Never the whole number in any markup.
export function maskPhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 4) return null;
  return `${'•'.repeat(6)}${digits.slice(-3)}`;
}
