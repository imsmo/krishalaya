'use server';
// apps/web-tenant/src/app/invoices/actions.ts · W151's GSTR-1 export and W152's credit note (PC-56 TENANT-3c-1).
// Both are finance-scoped server-side (`report.view`); the credit note additionally requires an APPROVED proposal on
// 0139's plane, so this file can never choose an amount. Every refusal is translated BY NAME — a statutory export
// that fails with "something went wrong" teaches an operator to retry until the month is over.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { isGstPeriod } from '../../features/invoices/console';
import { isCreditNoteReasonCode } from '../../features/invoices/reasons';
import { SdkError } from '@krishalaya/sdk-js';

const EXPORT_ERRORS: Record<string, string> = {
  GSTR1_PERIOD_OPEN: 'periodOpen',
  GSTR1_PERIOD_INVALID: 'period',
  GSTR1_TOO_LARGE: 'tooLarge',
  GSTR1_FORBIDDEN: 'forbidden',
};
const CREDIT_ERRORS: Record<string, string> = {
  CREDIT_NOTE_NO_APPROVAL: 'noApproval',
  CREDIT_NOTE_NOT_APPROVED: 'notApproved',
  CREDIT_NOTE_EXCEEDS_INVOICE: 'exceeds',
  CREDIT_NOTE_INVOICE_NOT_BROKEN_DOWN: 'noBreakdown',
  CREDIT_NOTE_ALREADY_ISSUED: 'alreadyIssued',
  CREDIT_NOTE_REASON_TOO_SHORT: 'reasonShort',
  CREDIT_NOTE_REASON_INVALID: 'reason',
  CREDIT_NOTE_FORBIDDEN: 'forbidden',
};
function keyOf(e: unknown, map: Record<string, string>): string {
  const code = e instanceof SdkError ? String((e as { code?: string }).code ?? '') : '';
  return map[code] ?? (e instanceof SdkError && e.status === 403 ? 'forbidden' : 'generic');
}

export async function exportGstr1Action(formData: FormData): Promise<void> {
  await requireSession('/invoices');
  const period = String(formData.get('period') ?? '').trim();
  if (!isGstPeriod(period)) redirect('/invoices?error=period');
  try {
    // The response carries the receipt (sha256, row count, coverage) and the excluded rows. Nothing here writes to
    // disk; the receipt is what makes the artefact checkable, and the coverage word is what stops a partial month
    // being read as a complete return.
    await tenantClient().payments.invoices.exportGstr1(period);
  } catch (e) { redirect(`/invoices?period=${period}&error=${keyOf(e, EXPORT_ERRORS)}`); }
  revalidatePath('/invoices');
  redirect(`/invoices?period=${period}&ok=exported`);
}

export async function issueCreditNoteAction(formData: FormData): Promise<void> {
  await requireSession('/invoices');
  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  if (!invoiceId) redirect('/invoices');
  const back = (qs: string): never => redirect(`/invoices/${encodeURIComponent(invoiceId)}?${qs}`);
  const approvalId = String(formData.get('approvalId') ?? '').trim();
  const reasonCode = String(formData.get('reasonCode') ?? '').trim();
  const reasonText = String(formData.get('reasonText') ?? '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(approvalId)) back('error=approval');
  if (!isCreditNoteReasonCode(reasonCode)) back('error=reason');
  // Checked here so a short reason is a form message rather than a round trip — and again server-side, and again by
  // 0140's CHECK, because the buyer reads this sentence on a document that changes what they owe.
  if (reasonText.length < 20) back('error=reasonShort');
  try {
    await tenantClient().payments.invoices.issueCreditNote(invoiceId, { approvalId, reasonCode, reasonText });
  } catch (e) { back(`error=${keyOf(e, CREDIT_ERRORS)}`); }
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/invoices');
  back('ok=credited');
}
