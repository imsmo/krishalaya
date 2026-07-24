// apps/mobile/src/core/mechanisms/theme.ts · DEV-20 mechanism 1/4 (dark). PURE resolver logic only (zero RN
// imports) → unit-tested under the "core" jest project, mirrors core/flags/flags.ts's pure-logic convention.
//
// HONEST BOUNDARY (verified before writing a single line of paint code — GROUND HONESTLY, contract §4):
// grep-checked `Phase-1 all screen design/Krishi_Verse_Design_System/system/screen.css` (the mobile farmer-app
// frame canon) for `data-theme`/`dark` → ZERO hits. `system/tokens.css` (the shared base file) carries only a
// 3-property STUB under its own header "DARK MODE — defer to Phase 2, but tokens reserved" (`--surface-page`,
// `--surface-card`, one inverted ink value) — never consumed by any mobile screen (screen.css never references
// `.dark-enabled` either). BRAND-026 (senior-mode's own ratifying doc) states explicitly: "consoles excluded —
// dark mode is the console-side variant, kept structurally separate". The ONE real, fully-built dark palette
// (`@krishi-verse/tokens`' `darkColors`, DEV-19 QA-passed) is generated from `system/web/web-tokens.css`'s
// `[data-theme="dark"]` block — APPLY-7/Q40, WEB-CONSOLE-SCOPED (the 4 Next.js apps), not this canon.
// → Mobile canon has NOT ratified a farmer-app dark palette. Per this batch's own founder brief: "implement what
// canon ratifies, note the rest." What ships here is the MODE-RESOLUTION MECHANISM (system/light/dark preference,
// OS-aware, persisted) as forward-compatible engineering infrastructure — real and testable — but this batch does
// NOT repaint any farmer screen with an invented palette. The one REAL, honest visual effect wired from this
// resolver is the OS status-bar icon color (see _layout.tsx), which genuinely depends on light/dark and needs no
// canon palette to be correct.

export type ThemeMode = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

export const DEFAULT_THEME_MODE: ThemeMode = 'system';
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/** Type guard for a value read back from storage (which may be stale/corrupt/pre-this-batch — never trust it). */
export function isThemeMode(v: unknown): v is ThemeMode {
  return v === 'system' || v === 'light' || v === 'dark';
}

/** Resolve the EFFECTIVE color scheme from the user's mode preference + the OS's reported scheme.
 * 'system' with an unknown/undetectable OS scheme degrades to 'light' (never crashes, never guesses 'dark'). Pure.
 */
export function resolveColorScheme(mode: ThemeMode, systemScheme: ColorScheme | null | undefined): ColorScheme {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return systemScheme === 'dark' ? 'dark' : 'light';
}

/** The RN StatusBar `style` prop value for a resolved scheme — light icons on a dark screen, dark icons on a
 * light one. This is the one real, canon-independent effect a resolved scheme safely drives today. Pure. */
export function statusBarStyleFor(scheme: ColorScheme): 'light' | 'dark' {
  return scheme === 'dark' ? 'light' : 'dark';
}
