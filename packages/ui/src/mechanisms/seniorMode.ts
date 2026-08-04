// packages/ui/src/mechanisms/seniorMode.ts · DEV-19 (Phase D4, "implement the 4 UI mechanisms" batch).
//
// SCOPE STATEMENT (read before assuming this duplicates APPLY-8's mobile senior mode): the canon's OWN
// senior-mode mechanism (`system/screen.css`'s `.screen.senior-mode` block, APPLY-8, G0-2 Q48 ratified) is
// explicitly scoped to the MOBILE FARMER-APP ONLY — `designer_pack/07-developer-handoff.md`'s own scoping-
// mechanisms table states this in the "Scope" column verbatim: "Mobile farmer-app only — not console." DEV-19
// targets the 4 WEB (console/storefront) apps, where no such mechanism has ever been designed or built. Per
// this batch's own founder brief: "console senior treatment per the same ratified multiplier" — this file is
// an ENGINEERING-OWED EXTENSION of Q48's ratified VALUES (1.30x type scale, 56px tap floor) to the web/console
// scope, not a re-application of an existing web mechanism and not itself a new design ratification (no new
// multiplier or floor value is invented here — both numbers are copied verbatim from the ratified mobile
// mechanism, `packages/tokens`'s own `seniorModeTypeScaleMultiplier` export and `system/tokens.css`'s
// `--tap-large` (56px), which `screen.css`'s own senior-mode block already generalizes to "ALL interactive
// controls" — the same instruction this file follows for the console's own control-height tokens). Flagged
// here, in `dev19_report.md`, and in this batch's DEV_TRACKER STATE block as a genuine boundary distinct from
// the other 3 mechanisms (dark/RTL/density), which all already had real web/console precedent to extend.
import { seniorModeTypeScaleMultiplier } from '@krishalaya/tokens';

/** Parses a raw (possibly attacker-controlled) cookie/preference value — fail-closed to OFF. */
export function isSeniorOn(raw: string | undefined | null): boolean {
  return raw === 'on';
}

/**
 * `[data-senior="true"]` console CSS fragment (any ancestor — typically `<html>`, matching how this package's
 * dark-mode `[data-theme="dark"]` selector is ALSO left unscoped to a `body.web` class per DEV-15..18's own
 * precedent: `packages/ui` has no `body.web`/`body.store` split of its own — that distinction lives only in
 * the HTML canon's storefront-vs-console realms, and this package is consumed only by console shells today).
 * Mirrors the exact structural pattern `screen.css`'s own `.screen.senior-mode` block uses: literal
 * `calc(Nrem * 1.30)` redefinitions of every
 * `--text-*` custom property (a custom property cannot reference its own prior value inside its own
 * redefinition at the same scope, so this is not, and cannot be, `calc(var(--text-base) * 1.3)`), plus a tap-
 * floor generalization — here applied to the WEB control-height tokens (`--web-control-h`/`--web-control-h-lg`)
 * since console density in this package is keyed off those two vars (see `density.ts`), not `--tap-min`/
 * `--tap-rural` (a mobile-only token pair the console side never consumes).
 */
export const seniorConsoleStyles = `
/* Senior-mode console extension (DEV-19, engineering-owed extension of G0-2 Q48's ratified 1.30x/56px values
   to the web/console scope — canon's own .screen.senior-mode mechanism is mobile-only, see this file's header
   comment). Additive + opt-in only: zero effect on any page without [data-senior="true"] present. */
[data-senior="true"] {
  --text-xs:   calc(0.75rem   * ${seniorModeTypeScaleMultiplier});
  --text-sm:   calc(0.875rem  * ${seniorModeTypeScaleMultiplier});
  --text-base: calc(1rem      * ${seniorModeTypeScaleMultiplier});
  --text-lg:   calc(1.125rem  * ${seniorModeTypeScaleMultiplier});
  --text-xl:   calc(1.25rem   * ${seniorModeTypeScaleMultiplier});
  --text-2xl:  calc(1.5rem    * ${seniorModeTypeScaleMultiplier});
  --text-3xl:  calc(1.875rem  * ${seniorModeTypeScaleMultiplier});
  --web-text-page-title: calc(1.5rem * ${seniorModeTypeScaleMultiplier});
  --web-text-section: calc(1.125rem * ${seniorModeTypeScaleMultiplier});
  --web-text-table: calc(0.875rem * ${seniorModeTypeScaleMultiplier});
  /* Tap floor generalized to ALL interactive console controls (both the 36px dense size AND the 44px "large"
     size collapse onto the 56px floor — the same "generalize to every control, not just the primary CTA"
     instruction BRAND-026/screen.css's own senior-mode block already established for mobile). */
  --web-control-h: 56px;
  --web-control-h-lg: 56px;
}
`;
