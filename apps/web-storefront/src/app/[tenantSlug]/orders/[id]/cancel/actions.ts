'use server';
// apps/web-storefront/src/app/[tenantSlug]/orders/[id]/cancel/actions.ts · PC-56 STORE-3a · C3 — the cancel act (canon W3083 → W3084 / W3085).
// AUTHENTICATED (requireSession + the authed serverClient). The form's reason is checked against the vocabulary THIS store offers (the API
// re-checks every rule in the cancel's own transaction — CANCEL_REASON_REQUIRED / _UNKNOWN / CANCEL_NOTE_REQUIRED); the act runs under the
// Idempotency-Key MINTED WHEN THE PAGE RENDERED, so a double tap or a retry after a concurrency refusal is the SAME request (the API binds the
// key to this order — sha256(orderId:key)). SUCCESS (W3084) → the order page `?ok=cancelled`, which prints the refund state from the payment
// read. FAILURE (W3085) → back to this page with the named outcome, the key (Retry with the same key) and the reason kept; the buyer's note is
// kept in a short-lived httpOnly cookie (never in the URL). The cancel then triggers STORE-2c's refund to source + restock (Law 9 — §9).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { cancelHref, orderHref, ordersHref, reasonOptions, checkCancelForm, cancelOutcomeKey, type CancelOutcome } from '../../../../../features/store3a/orders';
import { CANCEL_DRAFT_COOKIE, encodeCancelDraft } from '../../../../../features/store3a/cancel-draft';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const KEY = /^[A-Za-z0-9:_-]{8,120}$/;

export async function cancelOrderAction(fd: FormData): Promise<void> {
  const slug = String(fd.get('slug') ?? ''); const id = String(fd.get('id') ?? ''); const key = String(fd.get('key') ?? '');
  if (!SLUG.test(slug) || !UUID.test(id)) redirect('/');
  await requireSession(cancelHref(slug, id));
  const api = serverClient(slug);
  let options: ReturnType<typeof reasonOptions> = [];
  try { options = reasonOptions(await api.lookups.values('cancel_reason')); } catch { options = []; }
  const checked = checkCancelForm((k) => fd.get(k), options);

  let outcome: CancelOutcome | null = null;
  let kept = { reasonId: '', note: '' };
  if (!KEY.test(key)) outcome = 'failed';
  else if (!checked.ok) { outcome = checked.error; kept = checked.kept; }
  else {
    kept = { reasonId: checked.value.reasonId, note: checked.value.note ?? '' };
    try { await api.orders.cancel(id, key, checked.value.reasonId, checked.value.note); }
    catch (e) { outcome = cancelOutcomeKey(e instanceof SdkError ? e.code : null, e instanceof SdkError ? e.status : null); }
  }
  if (outcome) {
    // W3085: named, the values kept — the note in a cookie scoped to this store's order pages, ten minutes
    cookies().set(CANCEL_DRAFT_COOKIE, encodeCancelDraft({ orderId: id, note: kept.note }), { httpOnly: true, sameSite: 'lax', secure: true, path: `/${slug}/orders`, maxAge: 600 });
    const q: Record<string, string> = { error: outcome, k: key };
    if (kept.reasonId) q.r = kept.reasonId;
    redirect(cancelHref(slug, id, q));
  }
  cookies().set(CANCEL_DRAFT_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: true, path: `/${slug}/orders`, maxAge: 0 });   // the draft is spent
  revalidatePath(orderHref(slug, id));
  revalidatePath(ordersHref(slug));
  redirect(orderHref(slug, id, { ok: 'cancelled' }));
}
