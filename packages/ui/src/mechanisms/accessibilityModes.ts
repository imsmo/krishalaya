// packages/ui/src/mechanisms/accessibilityModes.ts · PC-56 STORE-5a · D4 (founder Q17) — High contrast and Calm motion, PER DEVICE, the
// `kvs_senior` shape (seniorMode.ts): a cookie the storefront's `/api/mechanism` sets, parsed here by PURE, fail-closed functions next to
// `isSeniorOn` (an attacker-controlled cookie value can only ever turn a mode OFF). The modes STACK with senior mode and with each other —
// each is its own `<html>` attribute (`data-contrast="true"`, `data-motion="calm"`), never one combined value.
//
// The phone's own settings are honoured WITHOUT a cookie (the storefront's CSS answers `prefers-contrast: more` and
// `prefers-reduced-motion: reduce`); the cookie only makes a mode explicit on this device. "Voice-first" is refused by name (no voice).

/** `kvs_contrast` — only the literal "on" turns High contrast on. */
export function isContrastOn(raw: string | undefined | null): boolean {
  return raw === 'on';
}

/** `kvs_motion` — only the literal "calm" turns Calm motion on. */
export function isCalmMotionOn(raw: string | undefined | null): boolean {
  return raw === 'calm';
}

/** The cookie values a mode's switch may post — anything else is not a value of that mode (the route refuses it by name). */
export const ACCESSIBILITY_COOKIE_VALUES = Object.freeze({ senior: ['on', 'off'], contrast: ['on', 'off'], motion: ['calm', 'off'] } as const);
export type AccessibilityMode = keyof typeof ACCESSIBILITY_COOKIE_VALUES;
