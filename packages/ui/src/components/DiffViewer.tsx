// packages/ui/src/components/DiffViewer.tsx · DEV-18 (Phase D3, packages/ui port batch 4 — specialized
// components). Ports `.kvw-diff`/`.kvw-diff-split`/word-level `mark.tok-add`/`mark.tok-del` verbatim from
// `web-components.css` lines 388-391 (original 2-rule base) + 645-671 (HAND-2's "DIFF VIEWER UPGRADE" —
// side-by-side mode, a 3rd "changed" line-type, word-level token highlighting), matching the real canon
// demo (`web-component-library.html` lines 448-462): inline mode with add/del/chg lines, and split mode
// with before/after panes. Queue row explicitly names this component ("diff viewer") — HAND-2's own 5 real
// consumers (feature-flags, plan-version-editor, cell-changes, audit-entity, role-editor) are cited as this
// port's grounding, not invented.
//
// 3 RENDERING CAPABILITIES (per the brief's "HAND-2's 3-mode component" framing — grounded against the
// canon's own 3 additions, not an invented taxonomy):
//   1. `mode="inline"` (default) — the canon's original 2-line pattern (`.kvw-diff .line.add`/`.del`)
//      EXTENDED with the 3rd "changed" line-type (`.line.chg`) HAND-2 added for a modified-not-added-or-
//      removed value (e.g. a template-id swap) — all 3 in one column.
//   2. `mode="split"` — `.kvw-diff-split`'s 2-column before/after grid, each pane's lines typed
//      `removed`/`added`/`unchanged`.
//   3. Word-level token highlighting (`highlightTokens`) — an ORTHOGONAL capability layered on TOP of
//      either mode (`mark.tok-add`/`mark.tok-del`), not a 3rd exclusive mode; canon's own demo applies it
//      inside an inline "chg" line (`<mark class="tok-del">KV-SMS-039</mark> → <mark class="tok-add">
//      KV-SMS-042</mark>`), so this component exposes it as a `tokens` array a line can optionally carry,
//      rendered instead of/alongside the line's plain text — the caller decides where to apply it (Law 3:
//      no NLP diffing logic invented here, the caller supplies the pre-computed before/after token pairs).
//
// Server-safe: pure presentational component, zero hooks, zero event-handler props — no `'use client'`
// needed (consistent with `Toolbar.tsx`/`Wizard.tsx`, unlike `Modal.tsx`/`FileUpload.tsx`).
import * as React from 'react';

/** Inline-mode line type — canon's own `.kvw-diff .line.add`/`.del`/`.chg` classes (web-components.css lines
 * 390-391 + 666). */
export type DiffInlineLineType = 'add' | 'del' | 'chg' | 'unchanged';
/** Split-mode line type — canon's OWN, DIFFERENT class vocabulary for the side-by-side pane
 * (`.kvw-diff-split .line.removed`/`.added`/`.unchanged`, web-components.css lines 660-662) — a genuinely
 * distinct set of class names from inline mode's `add`/`del`, not a naming inconsistency this component
 * introduces; both are reproduced verbatim, never conflated. */
export type DiffSplitLineType = 'added' | 'removed' | 'unchanged';

export interface DiffToken {
  text: string;
  /** Omit for a plain (non-highlighted) token — only `'add'`/`'del'` render a `<mark>`. */
  kind?: 'add' | 'del';
}

export interface DiffLine<T extends string = DiffInlineLineType> {
  /** Stable key for the row — caller-supplied (e.g. a source line number), never derived from content. */
  key: string;
  type: T;
  /** Plain-text rendering — used when `tokens` is omitted. */
  text?: string;
  /** Word-level token sequence (see header comment, capability 3) — when supplied, rendered instead of
   * `text`, each `kind: 'add' | 'del'` token wrapped in `mark.tok-add`/`mark.tok-del`. */
  tokens?: DiffToken[];
}

function renderLineContent(line: DiffLine<string>): React.ReactNode {
  if (line.tokens && line.tokens.length > 0) {
    return line.tokens.map((tok, i) =>
      tok.kind ? <mark key={i} className={`tok-${tok.kind}`}>{tok.text}</mark> : <React.Fragment key={i}>{tok.text}</React.Fragment>,
    );
  }
  return line.text ?? '';
}

export interface DiffViewerInlineProps {
  mode?: 'inline';
  lines: DiffLine<DiffInlineLineType>[];
  /** Accessible label for the whole diff region (gate 10 — a `<pre>`-like block has no implicit name). */
  label: string;
  className?: string;
}

export interface DiffViewerSplitProps {
  mode: 'split';
  /** Caller-i18n-resolved pane headings, e.g. "Before — v12" / "After — v13 (pending checker)" (Law 3). */
  beforeHeading: string;
  afterHeading: string;
  beforeLines: DiffLine<DiffSplitLineType>[];
  afterLines: DiffLine<DiffSplitLineType>[];
  label: string;
  className?: string;
}

export type DiffViewerProps = DiffViewerInlineProps | DiffViewerSplitProps;

export function DiffViewer(props: DiffViewerProps): React.ReactElement {
  if (props.mode === 'split') {
    const { beforeHeading, afterHeading, beforeLines, afterLines, label, className } = props;
    return (
      <div className={['kvw-diff-split', className || ''].filter(Boolean).join(' ')} role="group" aria-label={label}>
        <div className="pane before">
          <div className="pane-header">{beforeHeading}</div>
          {beforeLines.map((line) => (
            <div key={line.key} className={['line', line.type].filter(Boolean).join(' ')}>{renderLineContent(line)}</div>
          ))}
        </div>
        <div className="pane after">
          <div className="pane-header">{afterHeading}</div>
          {afterLines.map((line) => (
            <div key={line.key} className={['line', line.type].filter(Boolean).join(' ')}>{renderLineContent(line)}</div>
          ))}
        </div>
      </div>
    );
  }
  const { lines, label, className } = props;
  return (
    <div className={['kvw-diff', className || ''].filter(Boolean).join(' ')} role="group" aria-label={label}>
      {lines.map((line) => (
        <div key={line.key} className={['line', line.type].filter(Boolean).join(' ')}>{renderLineContent(line)}</div>
      ))}
    </div>
  );
}

/** CSS fragment. Base `.kvw-diff`/`.line.add`/`.line.del` ported verbatim from `web-components.css` lines
 * 388-391 + dark overrides 536/545; `.kvw-diff-split` family + `.line.chg` + `mark.tok-add`/`tok-del` ported
 * verbatim from lines 645-671 (HAND-2's diff-viewer upgrade — comment there confirms the base 2 rules are
 * UNCHANGED, this fragment preserves that same split). */
export const diffViewerStyles = `
.kvw-diff { font-family: var(--font-mono); font-size: var(--text-xs); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden; }
.kvw-diff .line { padding: 2px var(--space-3); white-space: pre; }
.kvw-diff .add { background: var(--color-success-light); color: var(--color-success-dark); }
.kvw-diff .del { background: var(--color-danger-light); color: var(--color-danger-dark); }
[data-theme="dark"] .kvw-diff .del { color: var(--color-danger-text-dark); }
[data-theme="dark"] .kvw-diff .add { color: var(--color-success-text-dark); }
.kvw-diff-split {
  display: grid; grid-template-columns: 1fr 1fr;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden;
  font-family: var(--font-mono); font-size: var(--text-xs);
}
.kvw-diff-split .pane-header {
  font-family: var(--font-body-en); font-weight: 700; font-size: var(--text-xs);
  padding: var(--space-2) var(--space-3); background: var(--color-earth-100);
  border-block-end: 1px solid var(--border-subtle);
}
.kvw-diff-split .pane + .pane { border-inline-start: 1px solid var(--border-subtle); }
.kvw-diff-split .line { padding: 2px var(--space-3); white-space: pre-wrap; word-break: break-word; }
.kvw-diff-split .line.removed { background: var(--color-danger-light); color: var(--color-danger-dark); }
.kvw-diff-split .line.added { background: var(--color-success-light); color: var(--color-success-dark); }
.kvw-diff-split .line.unchanged { color: var(--color-ink-400); }
[data-theme="dark"] .kvw-diff-split .line.removed { color: var(--color-danger-text-dark); }
[data-theme="dark"] .kvw-diff-split .line.added { color: var(--color-success-text-dark); }
.kvw-diff .line.chg { background: var(--color-info-light); color: var(--color-info-dark); }
[data-theme="dark"] .kvw-diff .line.chg { color: var(--color-info-text-dark); }
.kvw-diff mark.tok-add, .kvw-diff-split mark.tok-add { background: var(--color-success); color: var(--color-text-inverse); border-radius: 2px; padding: 0 3px; font-style: normal; }
.kvw-diff mark.tok-del, .kvw-diff-split mark.tok-del { background: var(--color-danger); color: var(--color-text-inverse); border-radius: 2px; padding: 0 3px; font-style: normal; text-decoration: line-through; }
`;
