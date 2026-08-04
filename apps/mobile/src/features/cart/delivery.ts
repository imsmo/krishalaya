// apps/mobile/src/features/cart/delivery.ts · PURE logic for the buyer delivery step (screen 129). No React/native
// deps (SDK types are `import type` → erased) → unit-tested. Money is bigint minor-unit strings (Law 2) — the
// "save on delivery" figure is computed with BigInt, never a float.
import type { DeliveryMethod } from '@krishalaya/sdk-js';

/** The delivery method to treat as selected: the caller's pick if it's still a real option, else the first offered
 * (server order), else null when there are none. Keeps the selection valid as the option set changes. Pure. */
export function defaultMethodId(methods: DeliveryMethod[], selected?: string | null): string | null {
  if (selected && methods.some((m) => m.id === selected)) return selected;
  return methods[0]?.id ?? null;
}

/** How much a given method SAVES versus the dearest option (drives the "✓ Save ₹X on delivery" hint on a free/
 * pickup method). = maxFeeAcrossMethods − thisMethodFee, as a bigint-minor string; null when it saves nothing or
 * the method isn't found. Never a float. Pure. */
export function deliverySavingMinor(methodId: string, methods: DeliveryMethod[]): string | null {
  const mine = methods.find((m) => m.id === methodId);
  if (!mine) return null;
  try {
    const fee = BigInt(mine.feeMinor);
    const max = methods.reduce((mx, m) => { const f = BigInt(m.feeMinor); return f > mx ? f : mx; }, 0n);
    const saving = max - fee;
    return saving > 0n ? saving.toString() : null;
  } catch { return null; }
}
