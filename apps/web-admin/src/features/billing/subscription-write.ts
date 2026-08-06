// apps/web-admin/src/features/billing/subscription-write.ts · PURE console rules for changing a subscription and for
// the invoice-PDF link (PC-56 ADMIN-1c). No IO, no React → unit-provable. Mirrors admin-api's
// domain/subscription-change.ts; grants nothing.

export const BILLING_CYCLES = ['monthly', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Statuses whose subscription may still be changed (mirror of `isChangeable`). A finished subscription is re-sold,
 *  not edited — so the page shows no controls at all rather than a form the server will refuse. */
const CHANGEABLE: ReadonlySet<string> = new Set(['trialing', 'active', 'past_due', 'paused']);
export function canChangeSubscription(status: string | null | undefined): boolean {
  return CHANGEABLE.has(String(status ?? ''));
}

/** Why the change controls are absent, so the page can say it. */
export type ChangeBlock = 'none' | 'finished' | 'no_subscription';
export function changeBlockedReason(status: string | null | undefined, hasSubscription: boolean): ChangeBlock {
  if (!hasSubscription) return 'no_subscription';
  return canChangeSubscription(status) ? 'none' : 'finished';
}

const MINOR_RE = /^\d{1,15}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Change plan
// ---------------------------------------------------------------------------
export type PlanChangeError = 'plan' | 'samePlan' | 'price' | 'cycle' | 'discount' | 'reason';
export type PlanChangeResult =
  | { ok: true; value: { planId: string; priceMinor: string; billingCycle: BillingCycle; discountPct?: string; immediate: boolean; reason: string } }
  | { ok: false; error: PlanChangeError };

/**
 * Build the change-plan body. The operator types the price in MAJOR units and a caller-supplied converter turns it
 * into minor units — no float ever touches money (Law 2).
 *
 * The price field is REQUIRED and has no "same as before" shortcut, mirroring the server. Carrying a starter price
 * onto an enterprise plan is a mistake nobody notices until an invoice lands.
 *
 * `currentPlanId` is passed in so the console can refuse a no-op locally: the server treats it as a 422, and telling
 * someone "it is already on that plan" before they type a reason is simply kinder.
 */
export function buildPlanChange(
  raw: { planId: string; priceMajor: string; billingCycle: string; discountPct?: string; immediate?: boolean; reason: string },
  currentPlanId: string | null | undefined,
  toMinor: (major: string) => string | undefined,
): PlanChangeResult {
  const planId = raw.planId.trim();
  if (!UUID_RE.test(planId)) return { ok: false, error: 'plan' };
  if (currentPlanId && planId === currentPlanId) return { ok: false, error: 'samePlan' };
  if (!(BILLING_CYCLES as readonly string[]).includes(raw.billingCycle)) return { ok: false, error: 'cycle' };

  const priceMinor = toMinor(raw.priceMajor.trim());
  // zero is refused here as it is server-side: a free period is a DISCOUNT on a real price, so that the platform
  // still knows what the tenant pays when the free period ends
  if (!priceMinor || !MINOR_RE.test(priceMinor) || priceMinor === '0') return { ok: false, error: 'price' };

  const discount = (raw.discountPct ?? '').trim();
  if (discount && !/^\d{1,3}(\.\d{1,2})?$/.test(discount)) return { ok: false, error: 'discount' };
  if (discount && Number(discount) > 100) return { ok: false, error: 'discount' };

  const reason = raw.reason.trim();
  if (reason.length < 3 || reason.length > 1000) return { ok: false, error: 'reason' };

  return {
    ok: true,
    value: {
      planId, priceMinor, billingCycle: raw.billingCycle as BillingCycle,
      ...(discount ? { discountPct: discount } : {}),
      immediate: raw.immediate === true, reason,
    },
  };
}

// ---------------------------------------------------------------------------
// Add-on
// ---------------------------------------------------------------------------
export type AddonError = 'code' | 'quantity' | 'price' | 'startsOn' | 'endsOn' | 'order' | 'reason';
export type AddonResult =
  | { ok: true; value: { addonCode: string; quantity: number; priceMinor: string; startsOn: string; endsOn?: string; reason: string } }
  | { ok: false; error: AddonError };

/** Build the add-addon body. A ZERO PRICE IS ALLOWED (a goodwill add-on is a normal gesture, and unlike a plan price
 *  its absence costs nothing) — but a negative one is not, and `endsOn` must be strictly after `startsOn` or the
 *  add-on would bill for a negative period. */
export function buildAddon(
  raw: { addonCode: string; quantity: string; priceMajor: string; startsOn: string; endsOn?: string; reason: string },
  toMinor: (major: string) => string | undefined,
): AddonResult {
  const addonCode = raw.addonCode.trim();
  if (addonCode.length < 2 || addonCode.length > 60) return { ok: false, error: 'code' };

  const q = raw.quantity.trim() || '1';
  if (!/^\d{1,5}$/.test(q)) return { ok: false, error: 'quantity' };
  const quantity = Number.parseInt(q, 10);
  if (quantity < 1 || quantity > 10_000) return { ok: false, error: 'quantity' };

  const priceMinor = toMinor(raw.priceMajor.trim() || '0');
  if (priceMinor === undefined || !MINOR_RE.test(priceMinor)) return { ok: false, error: 'price' };

  const startsOn = raw.startsOn.trim();
  if (!DATE_RE.test(startsOn)) return { ok: false, error: 'startsOn' };
  const endsOn = (raw.endsOn ?? '').trim();
  if (endsOn && !DATE_RE.test(endsOn)) return { ok: false, error: 'endsOn' };
  if (endsOn && endsOn <= startsOn) return { ok: false, error: 'order' };

  const reason = raw.reason.trim();
  if (reason.length < 3 || reason.length > 1000) return { ok: false, error: 'reason' };

  return { ok: true, value: { addonCode, quantity, priceMinor, startsOn, ...(endsOn ? { endsOn } : {}), reason } };
}

// ---------------------------------------------------------------------------
// Cancel at period end
// ---------------------------------------------------------------------------
/** What the cancel control should offer: schedule it, or REVOKE a scheduled cancellation. A tenant who changes their
 *  mind must not need a new subscription, so the revoke path is a first-class action rather than a support ticket. */
export function cancelToggleAction(cancelAtPeriodEnd: boolean | null | undefined): 'schedule' | 'revoke' {
  return cancelAtPeriodEnd === true ? 'revoke' : 'schedule';
}

// ---------------------------------------------------------------------------
// Invoice PDF (ADMIN-1-Q2)
// ---------------------------------------------------------------------------
export interface PdfLink { url?: string | null; expiresInSec?: number | null; fileName?: string | null; bytes?: string | null }

/** Whether a usable link came back. A blank url is treated as no link — the page then says the document is not
 *  available rather than rendering an anchor to nowhere. */
export function hasPdfLink(link: PdfLink | null | undefined): boolean {
  return !!link && typeof link.url === 'string' && link.url.trim().length > 0;
}

/** Human size for the link label. Returns null when bytes are unreadable — "0 KB" next to a real document would be
 *  read as a broken file. */
export function humanBytes(bytes: string | null | undefined): string | null {
  const s = String(bytes ?? '').trim();
  if (!/^\d{1,19}$/.test(s)) return null;
  const n = BigInt(s);
  if (n === 0n) return null;
  if (n < 1024n) return `${n} B`;
  if (n < 1024n * 1024n) return `${Number(n) / 1024 < 10 ? (Number(n) / 1024).toFixed(1) : Math.round(Number(n) / 1024)} KB`;
  return `${(Number(n) / (1024 * 1024)).toFixed(1)} MB`;
}
