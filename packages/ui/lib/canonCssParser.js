// packages/ui/lib/canonCssParser.js · DEV-58 (Phase D-UI-Port, batch 1).
//
// Shared CSS-rule parser used by BOTH `sync-from-design-system.js` (the generator, mirrors
// `packages/tokens/sync-from-design-system.js`'s naming/location convention) and
// `verify-canon-fidelity.js` (the byte-fidelity checker) — one parser, two consumers, so the
// two commands can never silently disagree about what a "rule" is.
//
// WHAT IT DOES: given raw CSS text (the canon's `web-frame.css` / `web-components.css`, or a
// component's hand-transcribed CSS-in-JS template string), strips comments and splits the text
// into an ORDERED list of top-level rules `{ selector, body, raw }`. An `@`-rule (`@media`,
// `@keyframes`, `@supports`) is kept as ONE opaque unit keyed by its own prelude (e.g.
// "@media (max-width: 1024px)") — this program does not need to reach inside a media query to
// prove component-level fidelity (no component in `packages/ui` embeds a partial media-query
// body today; if one ever does, this parser already treats the whole block as a single
// comparable unit, so nothing breaks, it just becomes coarser-grained).
//
// NORMALIZATION (the ONE documented, tested, reversible transform this program applies — task's
// own requirement: "if you transform, the transform must be explicit, tested, and reversible in
// review"): both the selector and the declaration body have every run of whitespace (newlines,
// tabs, repeated spaces — all the formatting freedom hand-transcription used) collapsed to a
// single space and trimmed. Nothing else changes: no re-ordering of declarations, no case
// folding, no unit rewriting, no color normalization. This transform is REVERSIBLE in review in
// the sense that a byte-diff of the two RAW (pre-normalization) strings is always available
// alongside the normalized comparison — see `verify-canon-fidelity.js`'s report, which prints
// both. `normalizeCss()` is exported and unit-tested (`__tests__/CanonCssParser.test.ts`)
// specifically so this transform's behavior is pinned, not just asserted in a comment.

/** Strips /* ... *\/ comments. Safe here (verified against both canon files): no CSS `content:`
 * string value anywhere in web-frame.css/web-components.css contains the literal two-character
 * sequence "/*", so a non-greedy regex removal cannot mis-fire inside a quoted string. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The one normalization transform (see header comment). Exported + unit-tested. */
function normalizeCss(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Parses `cssText` into an ordered array of `{ selector, rawSelector, body, rawBody, raw }`.
 * `selector`/`body` are normalized (see `normalizeCss`); `rawSelector`/`rawBody`/`raw` keep the
 * original (comment-stripped, otherwise untouched) text for byte-diff review.
 */
function parseRules(cssText) {
  const text = stripComments(cssText);
  const rules = [];
  const n = text.length;
  let i = 0;

  function skipWs(pos) {
    let p = pos;
    while (p < n && /\s/.test(text[p])) p++;
    return p;
  }

  while (i < n) {
    i = skipWs(i);
    if (i >= n) break;
    const startPrelude = i;

    // Scan to the top-level '{' that opens this rule's body (honoring quoted strings).
    let j = i;
    let inString = null;
    while (j < n) {
      const c = text[j];
      if (inString) {
        if (c === '\\') { j += 2; continue; }
        if (c === inString) inString = null;
        j++;
        continue;
      }
      if (c === '"' || c === "'") { inString = c; j++; continue; }
      if (c === '{') break;
      j++;
    }
    if (j >= n) break; // trailing whitespace/garbage, no more rules

    const rawSelector = text.slice(startPrelude, j).trim();

    // Scan to the matching closing '}', honoring nested braces (e.g. @keyframes/@media) and
    // quoted strings.
    let k = j;
    let depth = 0;
    inString = null;
    do {
      const c = text[k];
      if (inString) {
        if (c === '\\') { k += 2; continue; }
        if (c === inString) inString = null;
        k++;
        continue;
      }
      if (c === '"' || c === "'") { inString = c; k++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      k++;
    } while (depth > 0 && k < n);

    const rawBody = text.slice(j + 1, k - 1);
    const raw = text.slice(startPrelude, k);

    rules.push({
      selector: normalizeCss(rawSelector),
      rawSelector,
      body: normalizeCss(rawBody),
      rawBody,
      raw: normalizeCss(raw),
    });
    i = k;
  }

  return rules;
}

/** Builds a `Map<selector, rule[]>` (an array per key because canon legitimately redefines a
 * FEW selectors twice by design — e.g. `.kvw-range-presets` is widened at HAND-2, later in the
 * cascade — see `web-components.css` lines 327 and 621. Comparisons should accept a match
 * against ANY recorded body for that selector, not just the first/last.) */
function rulesToMap(rules) {
  const map = new Map();
  for (const rule of rules) {
    if (!map.has(rule.selector)) map.set(rule.selector, []);
    map.get(rule.selector).push(rule);
  }
  return map;
}

module.exports = { stripComments, normalizeCss, parseRules, rulesToMap };
