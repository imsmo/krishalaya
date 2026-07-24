// packages/ui/src/components/TreeView.tsx · DEV-17 (Phase D3, packages/ui port batch 3 —
// navigation/layout primitives). Ports `.kvw-tree`/`.kvw-tree-item`/`.chevron` verbatim from
// `web-components.css` lines 376-380 (base, W-D1) + 592-602 (chevron disclosure affordance, HAND-2 —
// "kvw-tree/.kvw-tree-item already existed but were 'named, not built'"), matching the real canon demo
// (`web-component-library.html` lines 258-266: a real org/geography tree — "Gujarat" > "Junagadh cluster"
// (selected) / "Rajkot cluster" / "Anand cluster", plus a collapsed sibling state "Maharashtra … 0 — Y2
// launch" — this component is the HAND-2 Guardian-path port, per the brief's own item 5).
//
// RTL CHEVRON MIRRORING (HAND-2, `web-components.css` lines 599-601): the resting glyph is mirrored via
// `scaleX(-1)` under `dir="rtl"` (it points toward reading-start at rest); the 90°-rotate-to-"expanded"
// transform is UNCHANGED in both directions (always +90deg) — ported verbatim, not re-derived.
//
// KEYBOARD (a11y enhancement, disclosed — canon's own demo has zero interactivity): Enter/Space selects a
// node; ArrowRight expands (or, if already expanded/a leaf, does nothing extra); ArrowLeft collapses (or,
// if already collapsed/a leaf, does nothing). This is a deliberately MINIMAL subset of the full WAI-ARIA
// tree-view keyboard pattern (no roving tabindex across the whole tree, no Up/Down-arrow node-to-node
// focus movement) — an honest minimum, boundary stated (same disclosure class as `DateRangePicker`'s own
// deferred calendar-day-grid logic), not a claim of full tree-keyboard-pattern compliance.
import * as React from 'react';

export interface TreeNode {
  key: string;
  label: string;
  /** Caller-i18n-resolved trailing meta text, e.g. "(1,842 farmers)" (Law 3 — no count formatting invented
   * here). */
  meta?: React.ReactNode;
  children?: TreeNode[];
}

export interface TreeViewProps {
  nodes: TreeNode[];
  selectedKey?: string;
  /** Caller-owned expand/collapse state (keyset-safe — this component holds no hidden internal state that
   * could desync from the caller's own data). */
  expandedKeys: ReadonlySet<string>;
  onToggleExpand: (key: string) => void;
  onSelect: (key: string) => void;
  /** Accessible name for the `role="tree"` root (Law 3 slot, e.g. "Tenant geography tree"). */
  ariaLabel: string;
  className?: string;
}

function TreeItems({ nodes, selectedKey, expandedKeys, onToggleExpand, onSelect }: Omit<TreeViewProps, 'ariaLabel' | 'className'>): React.ReactElement {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = !!node.children && node.children.length > 0;
        const expanded = expandedKeys.has(node.key);
        const isSelected = node.key === selectedKey;
        const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(node.key); return; }
          if (hasChildren && e.key === 'ArrowRight' && !expanded) { e.preventDefault(); onToggleExpand(node.key); return; }
          if (hasChildren && e.key === 'ArrowLeft' && expanded) { e.preventDefault(); onToggleExpand(node.key); }
        };
        return (
          <li key={node.key} role="treeitem" aria-expanded={hasChildren ? expanded : undefined} aria-selected={isSelected}>
            <div
              className={['kvw-tree-item', isSelected ? 'is-selected' : ''].filter(Boolean).join(' ')}
              tabIndex={0}
              onClick={() => onSelect(node.key)}
              onKeyDown={handleKeyDown}
            >
              {hasChildren ? (
                <svg
                  className="chevron"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"
                  onClick={(e) => { e.stopPropagation(); onToggleExpand(node.key); }}
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              ) : null}
              {node.label}
              {node.meta ? <span className="kvw-muted">{node.meta}</span> : null}
            </div>
            {hasChildren && expanded ? (
              <ul>
                <TreeItems nodes={node.children!} selectedKey={selectedKey} expandedKeys={expandedKeys} onToggleExpand={onToggleExpand} onSelect={onSelect} />
              </ul>
            ) : null}
          </li>
        );
      })}
    </>
  );
}

export function TreeView({ nodes, selectedKey, expandedKeys, onToggleExpand, onSelect, ariaLabel, className }: TreeViewProps): React.ReactElement {
  return (
    <ul className={['kvw-tree', className || ''].filter(Boolean).join(' ')} role="tree" aria-label={ariaLabel}>
      <TreeItems nodes={nodes} selectedKey={selectedKey} expandedKeys={expandedKeys} onToggleExpand={onToggleExpand} onSelect={onSelect} />
    </ul>
  );
}

/** CSS fragment ported verbatim from `web-components.css` lines 376-380, 592-602, dark override 526.
 * `.kvw-muted` duplicated from `web-components.css` line 473 under the same disclosed "safe to load twice"
 * precedent (needed for the node meta text, not previously exported by any DEV-15/16 fragment). */
export const treeViewStyles = `
.kvw-tree { list-style: none; margin: 0; padding: 0; font-size: var(--text-sm); }
.kvw-tree ul { list-style: none; padding-inline-start: var(--space-6); border-inline-start: 1px dashed var(--border-default); margin-inline-start: var(--space-3); }
.kvw-tree-item { display: flex; align-items: center; gap: var(--space-2); min-height: 32px; padding-inline: var(--space-2); border-radius: var(--radius-sm); cursor: pointer; }
.kvw-tree-item:hover { background: var(--color-earth-100); }
.kvw-tree-item.is-selected { background: var(--color-primary-50); color: var(--color-primary-700); font-weight: 600; }
.kvw-tree-item .chevron {
  display: inline-flex; flex: none; width: 14px; height: 14px;
  color: var(--color-ink-400); transition: transform var(--duration-fast) var(--ease-out);
}
li[aria-expanded="true"] > .kvw-tree-item .chevron { transform: rotate(90deg); }
li[aria-expanded="false"] > .kvw-tree-item .chevron,
li:not([aria-expanded]) > .kvw-tree-item .chevron { transform: rotate(0deg); }
[dir="rtl"] .kvw-tree-item .chevron { transform: scaleX(-1); }
[dir="rtl"] li[aria-expanded="true"] > .kvw-tree-item .chevron { transform: scaleX(-1) rotate(90deg); }
.kvw-tree-item:focus-visible { outline: none; box-shadow: var(--web-focus-ring); border-radius: var(--radius-sm); }
.kvw-muted { color: var(--color-ink-400); }
[data-theme="dark"] .kvw-tree-item.is-selected { color: var(--color-primary-400); }
`;
