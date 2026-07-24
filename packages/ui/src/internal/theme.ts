// packages/ui/src/internal/theme.ts · DEV-15 (Phase D3, packages/ui port batch 1).
//
// Single source of truth for every CSS custom-property VALUE this package's components consume.
// Contract law: `packages/tokens` is generated canon (never hand-edit); component code must consume it
// PROGRAMMATICALLY, never re-type a hex/px literal that already lives there (design contract §12 /
// DEV_CONTRACT §3 Law 4). This module is the one place that reads `@krishi-verse/tokens` and turns it
// into the exact CSS custom-property NAMES the canon (`system/web/web-components.css`,
// `system/web/web-tokens.css`) already uses, so every component file below just writes `var(--color-x)`
// exactly like the canon CSS does — never a second copy of the number.
//
// GENUINE GAP (disclosed, not silently absorbed — see DEV_TRACKER.md DEV-15 STATE block):
// `@krishi-verse/tokens` (HAND-1, generated from `system/tokens.css` + `system/web/web-tokens.css`) exports
// colors/spacing/typography/radii only. It does NOT export:
//   (a) web-only control geometry (--web-control-h, --web-control-h-lg, --web-focus-ring, table role colors)
//   (b) a `[data-theme="dark"]` variant map at all
//   (c) --border-subtle/default/strong (base/mobile canon derives these FROM the color scales, but the
//       tokens package doesn't re-export the derived roles)
//   (d) motion tokens (--duration-fast, --ease-out)
// The values below for those groups are copied VERBATIM from the cited canon source lines (not invented),
// each with its own citation comment. ENGINEERING-OWED: extend `packages/tokens/sync-from-design-system.js`
// (HAND-1's generator) to emit these too, so a future batch doesn't need to hand-cite them again — flagged,
// not fixed here (out of this batch's scope; packages/tokens is explicitly "never hand-edit" outside its
// own generator).
import { colors, radii, spacing, fontFamily, fontSize } from '@krishi-verse/tokens';
// DEV-18 addition: fontSize.xl / radii.xl are real exports on the tokens package (verified — packages/tokens/
// src/typography.ts line 19, spacing.ts line 26) not previously needed by DEV-15/16/17's atoms; wired below.

/** Light-mode (`:root`, i.e. default) custom-property values — name matches the canon var 1:1. */
export const lightVars: Record<string, string> = {
  // --- colors: every value below is read FROM @krishi-verse/tokens, never re-typed ---
  '--color-primary-50': colors.primary['50'],
  '--color-primary-600': colors.primary['600'],
  '--color-primary-700': colors.primary['700'],
  '--color-accent-500': colors.accent['500'],
  '--color-ink-400': colors.ink['400'],
  '--color-ink-500': colors.ink['500'],
  '--color-ink-600': colors.ink['600'],
  '--color-ink-700': colors.ink['700'],
  '--color-ink-800': colors.ink['800'],
  '--color-earth-50': colors.earth['50'],
  '--color-earth-100': colors.earth['100'],
  '--color-earth-200': colors.earth['200'],
  '--color-earth-300': colors.earth['300'],
  '--color-success-light': colors.success.light,
  '--color-success-dark': colors.success.dark,
  '--color-warning-light': colors.warning.light,
  '--color-warning-dark': colors.warning.dark,
  '--color-danger': colors.danger.base,
  '--color-danger-dark': colors.danger.dark,
  '--color-danger-light': colors.danger.light,
  // DEV-16 addition: base (non-light/dark) info/warning roles, needed by `.kvw-callout-info`/
  // `.kvw-alert-info`-shaped border-color values (web-components.css uses the BASE scale color for
  // borders, the light/dark pair only for background/text) — same programmatic-from-tokens rule as
  // every other value in this file, just not previously needed by DEV-15's 6 atoms.
  '--color-info': colors.info.base,
  '--color-warning': colors.warning.base,
  '--color-info-light': colors.info.light,
  '--color-info-dark': colors.info.dark,
  '--color-ai-light': colors.ai.light,
  '--color-ai-dark': colors.ai.dark,
  '--surface-card': colors.surface.card,
  // Theme-stable per web-tokens.css line 60 own comment ("stays white in dark mode") — cited literal, not derived.
  '--color-text-inverse': '#ffffff',
  // --- base/mobile canon border roles (system/tokens.css lines 95-97: border-subtle/default/strong derive
  //     from the earth/ink scales — same derivation, done here since packages/tokens doesn't re-export it) ---
  '--border-subtle': colors.earth['200'],
  '--border-default': colors.earth['300'],
  '--border-strong': colors.ink['300'],
  // --- spacing / radii / type — straight from packages/tokens ---
  '--space-1': spacing['1'], '--space-2': spacing['2'], '--space-3': spacing['3'],
  '--space-4': spacing['4'], '--space-6': spacing['6'], '--space-8': spacing['8'], '--space-10': spacing['10'],
  '--radius-sm': radii.sm, '--radius-md': radii.md, '--radius-lg': radii.lg, '--radius-full': radii.full,
  // QA-FIX [2026-07-25]: `.kvw-card`'s elevation value (web-tokens.css line 299: "Elevation = 1px border +
  // 1px lip, never blurry shadows") — a REAL, defined token (not a placeholder-only fallback), dropped by
  // DEV-16's `.kvw-card` port in `EmptyState.tsx`/`KpiCard.tsx` without disclosure; added here so those
  // fragments can restore `box-shadow: var(--shadow-lip, none);` byte-true to web-components.css line 151.
  '--shadow-lip': '0 1px 0 rgba(26, 26, 26, 0.07)',
  '--text-xs': fontSize.xs, '--text-sm': fontSize.sm, '--text-base': fontSize.base,
  '--text-3xl': fontSize['3xl'], // DEV-16 addition: KpiCard's `.kvw-kpi .value` (web-components.css line 396)
  '--font-mono': fontFamily.mono, '--font-body-en': fontFamily.body_en, '--font-display': fontFamily.display,
  // --- web-only geometry, verbatim from system/web/web-tokens.css (cited, not re-derivable from tokens pkg) ---
  '--web-control-h': '36px',       // web-tokens.css line 29
  '--web-control-h-lg': '44px',    // web-tokens.css line 30
  '--web-row-h-dense': '36px',     // web-tokens.css line 26
  '--web-cell-pad-x': spacing['3'],
  '--web-cell-pad-y': spacing['2'],
  '--web-text-table': fontSize.sm, // web-tokens.css line 35: var(--text-sm)
  '--web-focus-ring': `0 0 0 2px ${colors.surface.card}, 0 0 0 4px ${colors.primary['600']}`, // web-tokens.css line 39
  // --- table role colors (web-tokens.css lines 64-67 — resolve to token colors, cited here since the
  //     package doesn't export a --table-* namespace) ---
  '--table-header-bg': colors.earth['100'],
  '--table-row-hover': colors.earth['50'],
  '--table-row-selected': colors.primary['50'],
  '--table-border': colors.earth['200'], // = --border-subtle
  // --- currency (Golden Law 2/3: never hardcode ₹ in a component; canon's own affix mechanism) ---
  '--currency-symbol': '"₹"', // web-tokens.css line 44: --currency-symbol: "₹" (escaped, not a literal glyph typed into component markup)
  '--currency-code-display': '"INR"', // web-tokens.css line 57
  // --- motion (system/tokens.css lines 190/195 — cited literal, no packages/tokens export exists) ---
  '--duration-fast': '150ms',
  '--ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',

  // --- DEV-17 additions (Phase D3, packages/ui port batch 3 — navigation/layout primitives) ---
  // Console layout dimensions, verbatim from system/web/web-tokens.css lines 17-22 (no packages/tokens
  // export exists for web-only geometry, same genuine-gap class as DEV-15's --web-control-h group above).
  '--web-sidebar-w': '240px',
  '--web-sidebar-w-collapsed': '64px',
  '--web-topbar-h': '56px',
  '--web-content-max': '1200px',
  '--web-page-pad': spacing['6'], // web-tokens.css line 21: var(--space-6)
  '--web-card-gap': spacing['4'], // web-tokens.css line 22: var(--space-4)
  '--space-5': spacing['5'], // needed by topbar/drawer padding (web-frame.css/web-components.css), not previously exported
  '--text-lg': fontSize.lg, // needed by .kvw-sidebar-brand (web-frame.css line 52)
  '--text-2xl': fontSize['2xl'], // needed by --web-text-page-title below
  '--web-text-page-title': fontSize['2xl'], // web-tokens.css line 33: var(--text-2xl)
  '--web-text-section': fontSize.lg, // web-tokens.css line 34: var(--text-lg)
  '--web-transition-panel': '240ms cubic-bezier(0.16, 1, 0.3, 1)', // web-tokens.css line 94: "240ms var(--ease-out)" — same curve as --ease-out above, duplicated as a literal per this file's own no-var-references convention
  // Overlay z-index stack, verbatim from web-tokens.css lines 81-88 (web-only namespace, distinct from
  // mobile --z-* tokens per that file's own note — not re-exported by packages/tokens).
  '--web-z-sidebar': '30',
  '--web-z-topbar': '40',
  '--web-z-drawer': '90',
  '--web-z-modal': '100',
  // Elevation shadows: system/tokens.css lines 180-181 — GENUINE GAP, packages/tokens has no shadows
  // export at all (colors/spacing/typography/radii only per this file's header comment) — cited verbatim.
  '--shadow-lg': '0 10px 20px rgba(35, 42, 51, 0.06), 0 4px 8px rgba(35, 42, 51, 0.05)',
  '--shadow-xl': '0 20px 40px rgba(35, 42, 51, 0.08), 0 8px 16px rgba(35, 42, 51, 0.05)',
  '--surface-overlay': colors.surface.overlay, // .kvw-backdrop (web-components.css line 330), needed by Drawer
  '--color-primary-100': colors.primary['100'], // .kvw-avatar background (web-components.css line 452)

  // --- DEV-18 additions (Phase D3, packages/ui port batch 4 — specialized components) ---
  // `.kvw-wizard-shell` (web-components.css line 711) needs `--surface-page`, programmatic from
  // `@krishi-verse/tokens` (colors.surface.page, HAND-1's generator already exports it — this file simply
  // hadn't needed it yet before Wizard). `--web-z-toast` was ALREADY defined in web-tokens.css's z-stack
  // (line 85) at DEV-17 time but not yet consumed by any DEV-17 component — added now for Toast, verified
  // against the same citation (no re-derivation, same value).
  '--surface-page': colors.surface.page, // web-tokens.css line 88: var(--color-earth-50) == packages/tokens' own surface.page value
  '--web-z-toast': '120', // web-tokens.css line 85, same overlay z-stack DEV-17 already cited (81-88)
  '--text-xl': fontSize.xl, // .kvw-modal-title (web-components.css line 337)
  '--radius-xl': radii.xl, // .kvw-modal (web-components.css line 335)
};

/**
 * `[data-theme="dark"]` overrides — verbatim from `system/web/web-tokens.css` lines 137-213.
 * GENUINE GAP: `@krishi-verse/tokens` has NO dark-mode export at all (colors.ts is light-only) — every
 * value below is cited directly from canon, not derived from the tokens package. ENGINEERING-OWED: HAND-1's
 * generator should emit a `darkColors` map so a future batch can do here what `lightVars` above does.
 */
export const darkVars: Record<string, string> = {
  '--surface-card': '#1b232b',
  '--color-ink-700': '#e8ebee',
  '--color-ink-600': '#c3cad1',
  '--color-ink-500': '#aab4bd',
  '--color-ink-400': '#8a95a0',
  '--border-subtle': '#29323c',
  '--border-default': '#33404b',
  '--border-strong': '#4a5a67',
  '--table-header-bg': '#202832',
  '--table-row-hover': '#222c36',
  '--table-row-selected': '#1c3527',
  '--color-earth-50': '#161d24',
  '--color-earth-100': '#202832',
  '--color-earth-200': '#2a3440',
  '--color-earth-300': '#3a4652',
  '--color-primary-50': '#1c3527',
  '--color-success-light': '#12301e',
  '--color-warning-light': '#3a2a12',
  '--color-danger-light': '#3a1713',
  '--color-info-light': '#12293a',
  '--color-ai-light': '#2a1836',
  '--web-focus-ring': '0 0 0 2px #1b232b, 0 0 0 4px #5bb16e', // web-tokens.css line 152 (--color-primary-400)
  // AA-corrected dark-mode TEXT roles (web-tokens.css lines 197-202, APPLY-7/Q40) — used where canon
  // renders a "-dark" semantic AS TEXT (badges, money.in) rather than as a light-mode background tint.
  '--color-success-text-dark': '#6fcf97',
  '--color-warning-text-dark': '#f0b055',
  '--color-danger-text-dark': '#e57373',
  '--color-info-text-dark': '#6bb0e8',
  '--color-ai-text-dark': '#b67fcc',
  // DEV-17 addition: avatar-initials-on-primary-100-tint dark-mode text role (web-tokens.css line 197,
  // APPLY-7/Q40 AA-corrected set) — a dark-ONLY role, no light-mode equivalent needed (light avatar text
  // uses --color-primary-700 directly, already AA-safe against --color-primary-100 in light mode).
  '--color-primary-avatar-dark': '#7fc28e', // = colors.primary['300'], cited literal per this rule's own comment
};

/** Renders a `{ selector: string }` CSS custom-property block. Pure string builder, no DOM access. */
export function toCssVarBlock(selector: string, vars: Record<string, string>): string {
  const body = Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}
