// packages/ui/src/components/Tabs.tsx · DEV-17 (Phase D3, packages/ui port batch 3 —
// navigation/layout primitives). Ports `.kvw-tabs`/`.count` verbatim, and `.kvw-tab` ADAPTED (not
// verbatim — DEV-59 correction, see `qa_dev58_audit.md` §1(c)#3: this file's own comment previously
// overclaimed "ported verbatim", which DEV-58 QA found inaccurate) from `web-components.css` lines
// 242-253 (dark overrides 522-523), matching the real canon demo (`web-component-library.html`
// lines 237-240: `role="tablist"` + `role="tab"` buttons with `aria-selected`, one carrying a `.count`
// badge — plain `<button>` elements, canon ships zero keyboard-navigation JS on this static page).
// Canon actually splits `.kvw-tab` (base, button-context) from `.kvw-tabs a.kvw-tab` (an anchor-only
// variant adding `text-decoration:none; display:inline-flex; align-items:center`). This component
// renders `<button role="tab">` exclusively (never `<a>`), so its base `.kvw-tab` rule below merges
// in the anchor-variant's `display:inline-flex; align-items:center` plus an ADDED `font-family:
// inherit` (a real, necessary cross-browser fix: `<button>` elements do not inherit font the way
// `<a>` does by default, unlike canon's anchor-based demo, which never needed it) — a reasonable,
// disclosed button-vs-anchor semantic adaptation, not a visual bug, but genuinely not byte-identical
// to canon's own `.kvw-tab` rule.
//
// KEYBOARD BEHAVIOR (WAI-ARIA Tabs Pattern, automatic activation) — an a11y ENHANCEMENT over the canon's
// own static markup (disclosed, not a silent deviation: the canon page has no interactivity at all, this
// is a real production requirement, gate 10). Left/Right arrows move focus AND select the next/previous
// NON-DISABLED tab (wrapping); Home/End jump to the first/last non-disabled tab. The wrapping/skip-disabled
// logic is extracted into the pure, independently-testable `nextTabKey` function below — this repo's own
// test harness is `testEnvironment: 'node'` + `renderToStaticMarkup` (no jsdom, no simulated key events
// possible, see `jest.config.js`'s own header comment) — mirroring `DataTable.tsx`'s `nextSortDirection`
// precedent (DEV-16) for testing interaction logic honestly within that constraint.
import * as React from 'react';

export interface TabItem {
  key: string;
  /** Caller-i18n-resolved label (Law 3). */
  label: string;
  /** Caller-i18n-resolved, already-formatted count text (e.g. "1,204") — never computed/pluralized here. */
  count?: string;
  disabled?: boolean;
}

export type TabMoveKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/** Pure — given the current tab set, the currently-active key, and a navigation key, returns the key that
 * should become active. Returns `currentKey` unchanged if no non-disabled tab is available in that
 * direction (e.g. every other tab is disabled). RTL note: this function is direction-agnostic by design —
 * the CALLER is responsible for swapping which physical arrow key means "next" under `dir="rtl"` if it
 * wants that convention (the WAI-ARIA pattern permits either; this component does not swap, matching the
 * canon's own icon-mirroring precedent of leaving pure left/right key semantics alone unless a specific
 * screen's own JS wants to remap them — flagged, not silently assumed). */
export function nextTabKey(items: readonly TabItem[], currentKey: string, move: TabMoveKey): string {
  const enabledIdx = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
  if (enabledIdx.length === 0) return currentKey;
  const currentPos = items.findIndex((it) => it.key === currentKey);
  const currentEnabledPos = enabledIdx.indexOf(currentPos);
  if (move === 'Home') return items[enabledIdx[0]].key;
  if (move === 'End') return items[enabledIdx[enabledIdx.length - 1]].key;
  if (currentEnabledPos === -1) return items[enabledIdx[0]].key;
  const delta = move === 'ArrowRight' ? 1 : -1;
  const nextPos = (currentEnabledPos + delta + enabledIdx.length) % enabledIdx.length;
  return items[enabledIdx[nextPos]].key;
}

export interface TabsProps {
  items: readonly TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  /** Accessible name for the `role="tablist"` container (Law 3 slot). */
  ariaLabel: string;
  className?: string;
}

export function Tabs({ items, activeKey, onChange, ariaLabel, className }: TabsProps): React.ReactElement {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = nextTabKey(items, activeKey, e.key);
    if (next !== activeKey) onChange(next);
  };
  return (
    <div className={['kvw-tabs', className || ''].filter(Boolean).join(' ')} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const selected = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            className="kvw-tab"
            aria-selected={selected}
            disabled={item.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => !item.disabled && onChange(item.key)}
            onKeyDown={handleKeyDown}
          >
            {item.label}
            {item.count ? <span className="count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** CSS fragment. `.kvw-tabs`/`.count`/dark overrides ported verbatim from `web-components.css` lines
 * 242-253, 522-523. `.kvw-tab` itself is an ADAPTED merge of canon's base rule + its `.kvw-tabs a.kvw-tab`
 * anchor-variant declarations, plus an added `font-family: inherit` — see header comment for the full
 * DEV-59-corrected rationale (this rule intentionally remains a byte-level MISMATCH in
 * `verify-canon-fidelity.js`, not an oversight). */
export const tabsStyles = `
.kvw-tabs { display: flex; gap: var(--space-1); border-block-end: 1px solid var(--border-subtle); margin-block-end: var(--space-5); }
.kvw-tab {
  padding: var(--space-2) var(--space-4); border: none; background: transparent;
  font-family: inherit; font-size: var(--text-sm); font-weight: 600; color: var(--color-ink-500);
  border-block-end: 2px solid transparent; cursor: pointer; margin-block-end: -1px;
  display: inline-flex; align-items: center;
}
.kvw-tab:hover { color: var(--color-ink-700); }
.kvw-tab:focus-visible { outline: none; box-shadow: var(--web-focus-ring); border-radius: var(--radius-sm); }
.kvw-tab[aria-selected="true"] { color: var(--color-primary-700); border-block-end-color: var(--color-primary-600); }
/* [disabled] opacity is an ENGINEERING ADDITION (canon has no disabled-tab example anywhere) — a minimal,
   visually-conservative treatment, not a new visual language. */
.kvw-tab[disabled] { opacity: 0.5; cursor: not-allowed; }
.kvw-tabs a.kvw-tab { text-decoration: none; display: inline-flex; align-items: center; }
.kvw-tabs a.kvw-tab[aria-current="page"] { color: var(--color-primary-700); border-block-end-color: var(--color-primary-600); }
.kvw-tab .count { margin-inline-start: var(--space-1); font-size: var(--text-xs); background: var(--color-earth-200); border-radius: var(--radius-full); padding: 0 6px; }
[data-theme="dark"] .kvw-tab[aria-selected="true"] { color: var(--color-primary-400); border-block-end-color: var(--color-primary-400); }
[data-theme="dark"] .kvw-tabs a.kvw-tab[aria-current="page"] { color: var(--color-primary-400); border-block-end-color: var(--color-primary-400); }
`;
