#!/usr/bin/env node
// packages/tokens/sync-from-design-system.js · HAND-1 (Phase O, 2026-07-22).
//
// WHAT THIS DOES: reads the GENERATED (never hand-edited — see
// hand1_tokens_export.py at the farmer repo root) canon token export at
// ../../../Phase-1 all screen design/Krishi_Verse_Design_System/designer_pack/tokens/design-tokens.json
// and regenerates src/colors.ts, src/spacing.ts, src/typography.ts as
// canon-true TypeScript `as const` objects. This is the §12 packages/tokens
// consumption path: "consume packages/tokens programmatically (kill the
// hand-copied CSS vars)". Before this script did anything, IT WAS A STUB
// (`export {};` with a TODO comment) and packages/tokens/src/*.ts was itself a
// hand-typed placeholder that DID NOT MATCH the design canon at all — not
// merely stale, but wrong: different hex values (a "brand"/"neutral" palette
// with no correspondence to system/tokens.css's primary/accent/earth/ink
// scale) and a different font stack ('Noto Sans' vs the canon's Fraunces/
// Plus Jakarta Sans/Hind/Hind Vadodara/JetBrains Mono). See hand1_report.md
// for the full before/after diff.
//
// BLAST-RADIUS CHECK (done before regenerating, not assumed safe): grepped
// the whole krishi-verse/ tree for `@krishi-verse/tokens` imports outside this
// package itself — ZERO external consumers found (packages/ui's own
// components — Button.tsx, Input.tsx, etc. — are themselves unimplemented
// stubs, `export {};`, and do not import this package). Correcting the
// palette/font shape here changes nothing already rendering in production;
// this is a pure correction of dead-wrong scaffolding, not a live brand
// change requiring §17 escalation. If a future consumer is added BEFORE this
// script is next re-run, re-run it first so the consumer sees canon-true
// values from day one.
//
// USAGE: node sync-from-design-system.js   (from packages/tokens/, or via the
// package's own "sync" npm script). Re-run after any hand1_tokens_export.py
// regeneration. Never hand-edit src/colors.ts / src/spacing.ts /
// src/typography.ts directly — they are generated artifacts from here on
// (Q42 generated-artifact discipline, generalized to tokens by HAND-1).

const fs = require('fs');
const path = require('path');

const SOURCE_JSON = path.join(
  __dirname, '..', '..', '..',
  'Phase-1 all screen design', 'Krishi_Verse_Design_System',
  'designer_pack', 'tokens', 'design-tokens.json'
);

function loadExport() {
  const raw = fs.readFileSync(SOURCE_JSON, 'utf8');
  return JSON.parse(raw);
}

function pxNumber(v) {
  const m = /^([\d.]+)px$/.exec(v);
  return m ? Number(m[1]) : null;
}

function buildColors(webColor, webSurface) {
  const scaleGroups = { primary: {}, accent: {}, earth: {}, ink: {} };
  const semantic = { success: {}, warning: {}, danger: {}, info: {}, ai: {} };

  for (const [name, meta] of Object.entries(webColor)) {
    const scaleMatch = /^color-(primary|accent|earth|ink)-(\d+)$/.exec(name);
    if (scaleMatch) {
      scaleGroups[scaleMatch[1]][scaleMatch[2]] = meta.$value;
      continue;
    }
    const semMatch = /^color-(success|warning|danger|info|ai)(-light|-dark)?$/.exec(name);
    if (semMatch) {
      const key = semMatch[2] === '-light' ? 'light' : semMatch[2] === '-dark' ? 'dark' : 'base';
      semantic[semMatch[1]][key] = meta.$value;
      continue;
    }
  }
  // NOTE (bug found + fixed this batch): real canon has NO bare `--page`/`--card`/
  // `--overlay` custom properties — those names only existed in the FROZEN 2026-05-31
  // export. system/tokens.css instead defines `--surface-page`/`--surface-card`/
  // `--surface-overlay` (categorized "surface", not "color"). Read from there, and
  // resolve one level of var(--color-X-Y) indirection (--surface-page is itself
  // `var(--color-earth-50)` in source) so a native/RN consumer gets a real hex, not
  // an unresolvable CSS var() string.
  const resolveVar = (raw) => {
    const m = /^var\(--(color-[\w-]+)\)$/.exec(raw);
    if (m && webColor[m[1]]) return webColor[m[1]].$value;
    return raw;
  };
  const page = webSurface['surface-page'] ? resolveVar(webSurface['surface-page'].$value) : null;
  const card = webSurface['surface-card'] ? resolveVar(webSurface['surface-card'].$value) : null;
  const overlay = webSurface['surface-overlay'] ? resolveVar(webSurface['surface-overlay'].$value) : null;
  return { scaleGroups, semantic, page, card, overlay };
}

function tsObjLiteral(obj, indent = '  ') {
  const lines = Object.entries(obj).map(([k, v]) => {
    const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`;
    // JSON.stringify (not manual quote-wrapping) — the manual version broke on
    // font-family values that already contain single-quoted font names inside
    // the string (found + fixed this batch: produced invalid doubled-quote
    // TypeScript like `''Fraunces', 'Hind'...'`). JSON.stringify always
    // produces a correctly escaped, valid string literal regardless of content.
    const val = JSON.stringify(v);
    return `${indent}${key}: ${val},`;
  });
  return lines.join('\n');
}

// DEV-19 addition (Phase D4, "implement the 4 UI mechanisms" batch): the source JSON has carried a real
// `web.dark` scope (40 dark-console tokens: surface/color/border/table/chart/webLayout/role groups) since
// HAND-1 first generated it — it was simply never bridged into this package's TS output. `packages/ui`'s own
// `internal/theme.ts` disclosed this exact gap ("GENUINE GAP: @krishi-verse/tokens has NO dark-mode export at
// all... every value below is cited directly from canon, not derived from the tokens package") and flagged it
// ENGINEERING-OWED. This batch closes it the Q42 generated-artifact way (extend the generator, never hand-edit
// the output) rather than leaving `theme.ts`'s hand-cited literal object as the only copy of these values.
// `web.dark.console` (the `body.web[data-theme="dark"]` reconciliation block) is BYTE-IDENTICAL, key-for-key,
// to the overlapping subset of `web.dark` (verified this batch, both scopes' `surface`/`color`/`border`/`table`
// groups compared) — the console reconciliation block exists in the CSS canon only to win a specificity fight
// against `body.web`'s own light-mode override, a problem that does not exist for `packages/ui` (which injects
// a bare `:root`/`[data-theme="dark"]` `<style>` block with no competing `body.web {}` light rule of its own).
// So this generator emits ONE `darkColors` map from `web.dark` (a strict superset), not two.
function buildDarkColors(webDark) {
  const scaleGroups = { primary: {}, earth: {}, ink: {} };
  const semantic = { success: {}, warning: {}, danger: {}, info: {}, ai: {} };
  const textDark = {};
  for (const [name, meta] of Object.entries(webDark.color)) {
    const scaleMatch = /^color-(primary|earth|ink)-(\d+)$/.exec(name);
    if (scaleMatch) { scaleGroups[scaleMatch[1]][scaleMatch[2]] = meta.$value; continue; }
    const textMatch = /^color-(primary-avatar|success|warning|danger|info|ai)-(text-)?dark$/.exec(name);
    if (name === 'color-primary-avatar-dark') { textDark.primaryAvatarDark = meta.$value; continue; }
    const textDarkMatch = /^color-(success|warning|danger|info|ai)-text-dark$/.exec(name);
    if (textDarkMatch) { textDark[textDarkMatch[1]] = meta.$value; continue; }
    const lightMatch = /^color-(success|warning|danger|info|ai)-light$/.exec(name);
    if (lightMatch) { semantic[lightMatch[1]].light = meta.$value; continue; }
  }
  const surface = {};
  for (const [name, meta] of Object.entries(webDark.surface)) {
    surface[name.replace(/^surface-/, '')] = meta.$value;
  }
  const border = {};
  for (const [name, meta] of Object.entries(webDark.border)) {
    border[name.replace(/^border-/, '')] = meta.$value;
  }
  const table = {};
  for (const [name, meta] of Object.entries(webDark.table)) {
    table[name.replace(/^table-/, '')] = meta.$value;
  }
  const chartGrid = webDark.chart['chart-grid'].$value;
  return { scaleGroups, semantic, textDark, surface, border, table, chartGrid };
}

function main() {
  const exportData = loadExport();
  const prov = exportData.provenance;
  const header = `// @krishi-verse/tokens · GENERATED from designer_pack/tokens/design-tokens.json — DO NOT HAND-EDIT.
// Regenerate: node sync-from-design-system.js (source generated by hand1_tokens_export.py,
// which itself parses system/tokens.css + system/web/web-tokens.css — the true canon).
// Batch HAND-1, ${prov.generated}. Supersedes the pre-HAND-1 placeholder palette/font-stack,
// which did not correspond to canon at all (zero consumers existed at time of correction,
// grep-verified against krishi-verse/ — see hand1_report.md).
`;

  const web = exportData.scopes.web;
  const { scaleGroups, semantic, page, card, overlay } = buildColors(web.color, web.surface);

  // --- colors.ts ---
  let colorsTs = header;
  colorsTs += `export const colors = {\n`;
  for (const group of ['primary', 'accent', 'earth', 'ink']) {
    colorsTs += `  ${group}: {\n${tsObjLiteral(scaleGroups[group], '    ')}\n  },\n`;
  }
  for (const group of ['success', 'warning', 'danger', 'info', 'ai']) {
    colorsTs += `  ${group}: {\n${tsObjLiteral(semantic[group], '    ')}\n  },\n`;
  }
  colorsTs += `  surface: {\n    page: ${JSON.stringify(page)},\n    card: ${JSON.stringify(card)},\n    overlay: ${JSON.stringify(overlay)},\n  },\n`;
  colorsTs += `} as const;\nexport type ColorScale = typeof colors;\n`;

  // --- spacing.ts ---
  const spacingVals = {};
  for (const [name, meta] of Object.entries(web.spacing)) {
    spacingVals[name.replace(/^space-/, '')] = meta.$value;
  }
  const radiiVals = {};
  for (const [name, meta] of Object.entries(web.radius)) {
    radiiVals[name.replace(/^radius-/, '')] = meta.$value;
  }
  const tapVals = {};
  for (const [name, meta] of Object.entries(web.touchTarget)) {
    tapVals[name.replace(/^tap-/, '')] = meta.$value;
  }
  let spacingTs = header;
  spacingTs += `export const spacing = {\n${tsObjLiteral(spacingVals)}\n} as const;\n`;
  spacingTs += `export const radii = {\n${tsObjLiteral(radiiVals)}\n} as const;\n`;
  spacingTs += `// NOTE: canon has no dedicated --bp-* custom properties (checked this batch — the\n`;
  spacingTs += `// breakpoint figures documented in system/web/web-tokens.css are a PROSE COMMENT, not\n`;
  spacingTs += `// live tokens; real breakpoints are literal numbers inside @media rules: console\n`;
  spacingTs += `// 768/1024/1440, storefront 360/768/1440). Kept here as the nearest literal values so\n`;
  spacingTs += `// downstream code has SOMETHING to import; flagged ENGINEERING-OWED if a real --bp-*\n`;
  spacingTs += `// custom-property set should be added to system/web/web-tokens.css upstream instead.\n`;
  spacingTs += `export const breakpoints = { sm: '360px', md: '768px', lg: '1024px', xl: '1440px' } as const;\n`;
  spacingTs += `// Minimum tap targets (contract §8 / tokens.css --tap-*). touchTargetMinPx keeps the prior\n`;
  spacingTs += `// export's name for import-compatibility; value corrected to canon's --tap-min (44px).\n`;
  spacingTs += `export const touchTarget = {\n${tsObjLiteral(tapVals)}\n} as const;\n`;
  spacingTs += `export const touchTargetMinPx = ${pxNumber(tapVals['min']) ?? 44};\n`;

  // --- typography.ts ---
  const fontFamilyVals = {};
  for (const [name, meta] of Object.entries(web.fontFamily)) {
    fontFamilyVals[name.replace(/^font-/, '').replace(/-/g, '_')] = meta.$value;
  }
  const fontSizeVals = {};
  for (const [name, meta] of Object.entries(web.fontSize)) {
    fontSizeVals[name.replace(/^text-/, '')] = meta.$value;
  }
  const fontWeightVals = {};
  for (const [name, meta] of Object.entries(web.fontWeight)) {
    fontWeightVals[name.replace(/^weight-/, '')] = Number(meta.$value);
  }
  const lineHeightVals = {};
  for (const [name, meta] of Object.entries(web.lineHeight)) {
    lineHeightVals[name.replace(/^leading-/, '')] = Number(meta.$value);
  }
  let typographyTs = header;
  typographyTs += `export const fontFamily = {\n${tsObjLiteral(fontFamilyVals)}\n} as const;\n`;
  typographyTs += `export const fontSize = {\n${tsObjLiteral(fontSizeVals)}\n} as const;\n`;
  typographyTs += `export const fontWeight = {\n${tsObjLiteral(fontWeightVals)}\n} as const;\n`;
  typographyTs += `export const lineHeight = {\n${tsObjLiteral(lineHeightVals)}\n} as const;\n`;
  typographyTs += `// Senior-mode type-scale multiplier (BRAND-026, G0-2 Q48 ratified). Multiply any\n`;
  typographyTs += `// base fontSize value by this constant when Senior Mode is active (mobile app only —\n`;
  typographyTs += `// see designer_pack/07-developer-handoff.md's Scoping Mechanisms section).\n`;
  typographyTs += `export const seniorModeTypeScaleMultiplier = 1.30;\n`;

  // --- colorsDark.ts (DEV-19: web.dark scope bridge, see buildDarkColors() header comment) ---
  const dark = buildDarkColors(exportData.scopes['web.dark']);
  let colorsDarkTs = header;
  colorsDarkTs += `// Bridges \`web.dark\` (40 dark-console tokens, generated by hand1_tokens_export.py from\n`;
  colorsDarkTs += `// system/web/web-tokens.css's [data-theme="dark"] block, APPLY-7/G0-2-Q40) — previously present in\n`;
  colorsDarkTs += `// design-tokens.json but never bridged into this package (packages/ui's own internal/theme.ts had\n`;
  colorsDarkTs += `// disclosed this as a GENUINE GAP / ENGINEERING-OWED item at DEV-15/17). DEV-19 closes it.\n`;
  colorsDarkTs += `export const darkColors = {\n`;
  for (const group of ['primary', 'earth', 'ink']) {
    colorsDarkTs += `  ${group}: {\n${tsObjLiteral(dark.scaleGroups[group], '    ')}\n  },\n`;
  }
  colorsDarkTs += `  // light-tint remap only (no -base/-dark change needed for these 5 semantics in dark scope)\n`;
  for (const group of ['success', 'warning', 'danger', 'info', 'ai']) {
    colorsDarkTs += `  ${group}: {\n${tsObjLiteral(dark.semantic[group], '    ')}\n  },\n`;
  }
  colorsDarkTs += `  // AA-corrected dark-only TEXT roles (APPLY-7 apply7_aa_report.json — 3 of BRAND-025's own named\n`;
  colorsDarkTs += `  // AA failures + 2 more this program's own wider census found; see web-tokens.css lines 178-202)\n`;
  colorsDarkTs += `  textDark: {\n${tsObjLiteral(dark.textDark, '    ')}\n  },\n`;
  colorsDarkTs += `  surface: {\n${tsObjLiteral(dark.surface, '    ')}\n  },\n`;
  colorsDarkTs += `  border: {\n${tsObjLiteral(dark.border, '    ')}\n  },\n`;
  colorsDarkTs += `  table: {\n${tsObjLiteral(dark.table, '    ')}\n  },\n`;
  colorsDarkTs += `  chartGrid: ${JSON.stringify(dark.chartGrid)},\n`;
  colorsDarkTs += `} as const;\nexport type DarkColorScale = typeof darkColors;\n`;

  fs.writeFileSync(path.join(__dirname, 'src', 'colors.ts'), colorsTs);
  fs.writeFileSync(path.join(__dirname, 'src', 'spacing.ts'), spacingTs);
  fs.writeFileSync(path.join(__dirname, 'src', 'typography.ts'), typographyTs);
  fs.writeFileSync(path.join(__dirname, 'src', 'colorsDark.ts'), colorsDarkTs);

  console.log('Synced from', SOURCE_JSON);
  console.log('Wrote src/colors.ts, src/spacing.ts, src/typography.ts, src/colorsDark.ts');
}

main();
