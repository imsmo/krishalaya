'use server';
// apps/web-tenant/src/app/wallet/transactions/actions.ts · W144's "Export CSV" (PC-56 TENANT-4a).
// The export is a READ — it moves no money and needs no Idempotency-Key — but it is still an audited act,
// so it goes through the API's receipt path (row count, sha256 over the canonical payload, requester,
// coverage) rather than being assembled from rows the page already has. Two reasons: the file and the
// screen must not be able to disagree, and a receipt computed in the browser proves nothing.
//
// Every refusal is translated BY NAME. WALLET_EXPORT_TOO_LARGE tells an operator to narrow the window —
// "something went wrong" gets pressed again on the same decade of ledger.
import { redirect } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { accountFilter, isAllowedWindow, isIsoDate } from '../../../features/wallet/org-console';
import { SdkError } from '@krishalaya/sdk-js';

export async function exportLedgerAction(form: FormData): Promise<void> {
  await requireSession('/wallet/transactions');
  const from = String(form.get('from') ?? '');
  const to = String(form.get('to') ?? '');
  const account = accountFilter(String(form.get('account') ?? '')) ?? undefined;
  const type = String(form.get('type') ?? '') || undefined;

  const back = new URLSearchParams();
  if (isIsoDate(from)) back.set('from', from);
  if (isIsoDate(to)) back.set('to', to);
  if (account) back.set('account', account);
  if (type) back.set('type', type);

  // Checked here as well as server-side: a window the API will refuse should not cost a round trip and
  // should not read as a server failure when it is a client-side rule the screen already knows.
  if (!isIsoDate(from) || !isIsoDate(to) || !isAllowedWindow(from, to)) {
    back.set('error', 'WALLET_WINDOW_INVALID');
    redirect(`/wallet/transactions?${back.toString()}`);
  }

  try {
    const res = await tenantClient().orgWallet.export({ from, to, account, type });
    // The receipt's OWN row count is what the screen reports — not `res.rows.length`, which is the same
    // number computed a second time and therefore the one that could quietly differ.
    back.set('ok', String(res.receipt.rowCount));
  } catch (e) {
    const code = e instanceof SdkError ? String((e as { code?: string }).code ?? '') : '';
    back.set('error', code === 'WALLET_EXPORT_TOO_LARGE' ? 'WALLET_EXPORT_TOO_LARGE' : 'WALLET_EXPORT_FAILED');
  }
  redirect(`/wallet/transactions?${back.toString()}`);
}
