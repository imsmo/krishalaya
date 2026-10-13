// apps/web-storefront/src/features/home/trace-code.ts · PC-56 STORE-1b · C2 — "Scan a trace QR" WITHOUT a camera. PURE.
// The home's trace entry is a plain GET form (works with no client JS): `/trace?code=<typed>` → this decides where it goes. A QR token is
// URL-safe text (letters, digits, `-`, `_`); anything else is answered on the page ("that doesn't look like a trace code"), never sent on.
// A camera scanner is refused by name on the page (features/home/refusals.ts `camera_scanner`).
export function traceCodeHref(raw: string | string[] | undefined): string | null {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(v)) return null;
  return `/trace/${encodeURIComponent(v)}`;
}
