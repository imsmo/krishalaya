// apps/web-tenant/src/features/invoices/reasons.ts · the credit-note reason vocabulary, copied from the API's own
// enum (payments/domain/credit-note.ts) so the console cannot offer a code the server would reject with a 422 — the
// same rule the returns console follows for dispute reasons (PC-56 TENANT-3c-1).
export const CREDIT_NOTE_REASON_CODES = ['goods_returned', 'quantity_short', 'quality_rejected', 'price_correction', 'order_cancelled', 'tax_correction'] as const;
export type CreditNoteReasonCode = (typeof CREDIT_NOTE_REASON_CODES)[number];
export function isCreditNoteReasonCode(v: string | null | undefined): v is CreditNoteReasonCode {
  return !!v && (CREDIT_NOTE_REASON_CODES as readonly string[]).includes(v);
}
