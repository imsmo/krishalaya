'use server';
// apps/web-tenant/src/app/logistics/freight/actions.ts · W241/W242's writes (PC-56 TENANT-5c).
//
// **NONE OF THESE ROUTES EXISTED.** `freight_invoices` and `freight_invoice_lines` were created in migration 0070
// with RLS policies and have had no entity, no repository, no service, no controller, no SDK method and no screen
// since. Every action below is new API surface this wave built, reached from the first console that can reach it.
//
// Idempotency-Key (Law 3, `randomUUID()` per submission) on record, reconcile, resolve and close — all four move or
// commit money-adjacent facts. `dispute` deliberately carries none: it is idempotent by construction, because
// disputing an already-disputed line rewrites that one row with the operator's newest words, and a stale key would
// stop an operator correcting their own reason.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { DEFAULT_FREIGHT_CURRENCY, parseLines, validateDraft, type FreightDraft } from '../../../features/logistics/freight';

const BASE = '/logistics/freight';

/** The API's own stable code rides back in the URL and the page translates it BY NAME — never a raw message, which
 *  would put an untranslated English server string in front of a Gujarati operator (Law 7). */
function fail(e: unknown, at: string): never {
  const err = e instanceof SdkError ? e : null;
  const code = err?.isValidation ? 'validation' : err?.code ?? 'generic';
  redirect(`${at}${at.includes('?') ? '&' : '?'}error=${encodeURIComponent(code)}`);
}

/**
 * W241's [Upload carrier invoice] → W2612–W2615's chain.
 *
 * The lines are the point: a header alone cannot be reconciled line by line, which is the only thing this desk
 * does. They are validated here with the SAME pure rules the review step rendered and the server's entity
 * re-enforces — including the sum check, because an upload that dropped a line manufactures a "variance" that is
 * our own transcription error wearing the carrier's coat.
 */
export async function recordFreightInvoiceAction(formData: FormData): Promise<void> {
  await requireSession(`${BASE}/new`);
  const draft: FreightDraft = {
    carrierId: String(formData.get('carrierId') ?? ''),
    invoiceNo: String(formData.get('invoiceNo') ?? ''),
    sourceKind: String(formData.get('sourceKind') ?? 'carrier_invoice') === 'own_fleet_cost_note' ? 'own_fleet_cost_note' : 'carrier_invoice',
    periodStart: String(formData.get('periodStart') ?? ''),
    periodEnd: String(formData.get('periodEnd') ?? ''),
    billedMinor: String(formData.get('billedMinor') ?? ''),
    currencyCode: String(formData.get('currencyCode') ?? DEFAULT_FREIGHT_CURRENCY).toUpperCase(),
    linesRaw: String(formData.get('linesRaw') ?? ''),
  };
  // W2612: every invalid field listed with its reason, the values preserved, nothing saved. The draft rides back in
  // the query so the form re-renders what was typed — a validation error that empties a 40-line paste is a
  // punishment, and the operator would go back to reconciling in a spreadsheet.
  const errors = validateDraft(draft);
  if (errors.length > 0) {
    const qs = new URLSearchParams({
      step: 'form', invalid: errors.map((e) => e.field).join(','),
      carrierId: draft.carrierId, invoiceNo: draft.invoiceNo, sourceKind: draft.sourceKind,
      periodStart: draft.periodStart, periodEnd: draft.periodEnd, billedMinor: draft.billedMinor,
      currencyCode: draft.currencyCode, linesRaw: draft.linesRaw,
    });
    redirect(`${BASE}/new?${qs.toString()}`);
  }
  const lines = parseLines(draft.linesRaw).lines;
  let id: string | null = null;
  try {
    const inv = await tenantClient().freight.record({
      carrierId: draft.carrierId,
      invoiceNo: draft.invoiceNo.trim(),
      sourceKind: draft.sourceKind,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      billedMinor: draft.billedMinor,
      currencyCode: draft.currencyCode,
      lines: lines.map((l) => ({ awbNo: l.awbNo, billedMinor: l.billedMinor, billedAttempts: l.billedAttempts })),
    }, randomUUID());
    id = inv.id;
  } catch (e) { fail(e, `${BASE}/new`); }
  revalidatePath(BASE);
  // Straight to the recon, because recording a bill reconciles nothing and the next act is the whole point.
  redirect(`${BASE}/${encodeURIComponent(id!)}?ok=recorded`);
}

/** W241's [Reconcile] / W2616's confirm. Re-runnable: the match is recomputed from our shipments, and re-running it
 *  after a shipment was corrected is a normal operator act rather than a mistake to be blocked. */
export async function reconcileFreightAction(formData: FormData): Promise<void> {
  await requireSession(BASE);
  const id = String(formData.get('id') ?? '').trim();
  const back = String(formData.get('back') ?? BASE);
  if (!id) redirect(`${BASE}?error=generic`);
  try {
    await tenantClient().freight.reconcile(id, randomUUID());
  } catch (e) { fail(e, back); }
  revalidatePath(BASE);
  redirect(`${BASE}/${encodeURIComponent(id)}?ok=reconciled`);
}

/** W242's per-line dispute. The API classifies the reason CODE from our own evidence; the operator's words are
 *  recorded beside it and never instead of it — a coded class is what a pack can be assembled from, and free text
 *  is what a carrier actually reads. */
export async function disputeFreightLineAction(formData: FormData): Promise<void> {
  await requireSession(BASE);
  const id = String(formData.get('id') ?? '').trim();
  const lineId = String(formData.get('lineId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const at = `${BASE}/${encodeURIComponent(id)}`;
  if (!id || !lineId) redirect(`${BASE}?error=generic`);
  if (reason.length < 10) redirect(`${at}?act=dispute&line=${encodeURIComponent(lineId)}&error=reasonTooShort`);
  try {
    await tenantClient().freight.disputeLine(id, lineId, reason);
  } catch (e) { fail(e, at); }
  revalidatePath(at);
  redirect(`${at}?ok=disputed`);
}

/** Agreed or withdrawn. `agreed` REPLACES the billed amount with what will actually be paid, so it needs a key: a
 *  double-tapped button must not book two settlements of one argument. */
export async function resolveFreightLineAction(formData: FormData): Promise<void> {
  await requireSession(BASE);
  const id = String(formData.get('id') ?? '').trim();
  const lineId = String(formData.get('lineId') ?? '').trim();
  const outcome = String(formData.get('outcome') ?? '') === 'agreed' ? 'agreed' : 'withdrawn';
  const agreedMinor = String(formData.get('agreedMinor') ?? '').trim();
  const at = `${BASE}/${encodeURIComponent(id)}`;
  if (!id || !lineId) redirect(`${BASE}?error=generic`);
  if (outcome === 'agreed' && !/^\d{1,18}$/.test(agreedMinor)) {
    redirect(`${at}?act=resolve&line=${encodeURIComponent(lineId)}&error=agreedAmount`);
  }
  try {
    await tenantClient().freight.resolveLine(id, lineId, {
      outcome,
      agreedMinor: outcome === 'agreed' ? agreedMinor : undefined,
    }, randomUUID());
  } catch (e) { fail(e, at); }
  revalidatePath(at);
  redirect(`${at}?ok=resolved`);
}

/** Close the recon — or book an own-fleet cost note to ops. This RELEASES W241's payment hold and pays nothing,
 *  which the success copy says out loud: there is no payee for a carrier on these rails. */
export async function closeFreightAction(formData: FormData): Promise<void> {
  await requireSession(BASE);
  const id = String(formData.get('id') ?? '').trim();
  const booked = String(formData.get('booked') ?? '') === 'true';
  const back = String(formData.get('back') ?? BASE);
  if (!id) redirect(`${BASE}?error=generic`);
  try {
    await tenantClient().freight.close(id, randomUUID());
  } catch (e) { fail(e, back); }
  revalidatePath(BASE);
  redirect(`${BASE}/${encodeURIComponent(id)}?ok=${booked ? 'booked' : 'closed'}`);
}
