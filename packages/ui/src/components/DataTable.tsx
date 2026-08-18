'use client';
// packages/ui/src/components/DataTable.tsx · DEV-15 (honest minimum) + DEV-16 (deepening, Phase D3,
// packages/ui port batch 2 — data display). Ports canon classes `.kvw-table-wrap` / `.kvw-table` /
// `.kvw-table-toolbar` / `.sortable`/`.sort`/`[aria-sort]` / `.kvw-col-check` / `.is-selected` /
// `.kvw-row-kebab` / `.kvw-bulkbar` / `.kvw-table-state` / `.kvw-skeleton-row` / `.kvw-table-footer` /
// `.kvw-pagination` / `.kvw-page-btn` / `.kvw-pagesize` verbatim from
// `Phase-1 all screen design/Krishi_Verse_Design_System/system/web/web-components.css` lines 159-235
// ("the core web object — all 6 states" per that file's own section header) and the fully-loaded demo
// (`system/web/web-component-library.html` lines 159-234: "Sticky header · sort · selection · bulk bar ·
// server-side pagination · count summary").
//
// THE 6 STATES (design contract `KRISHI_VERSE_MASTER_WORK_CONTRACT.md` §6 line 61, verbatim): "default-
// populated · loading skeleton · empty (with explaining CTA) · error (with retry) · permission-denied ·
// flagged-off (where applicable)". This component's `state` prop is exactly that enum (`default` |
// `loading` | `empty` | `error` | `denied` | `flagged-off`), the DEV-15 minimum's 4-state `status` prop
// (`loading`/`empty`/`error`/`populated`) renamed+extended to match the contract's own vocabulary 1:1
// (zero real consumers existed at time of writing — grep-verified, see dev16_report.md — so this is a
// safe rename, not a breaking change to any live caller). Canon-true presentations per state, sourced from
// two concrete canon screens, not invented:
//   - empty/error/denied: `web-component-library.html` lines 219-234 (3-card states grid: "No listings
//     yet" / "Couldn't load listings" (error, retry) / "Permission needed" (denied, no action — canon
//     shows none)).
//   - flagged-off: `W128-tenant-listings-bulk.html` line 112 ("Flagged off — Bulk Upload disabled … This
//     module is switched off for this tenant/plan (feature flag)."), the canon's own named flagged-off
//     table-state card (added at BODY-1 per that file's inline comment).
// All 4 non-default/loading states are now composed via the shared `EmptyState` atom (this same batch) —
// "EmptyState integration" per the DEV-16 brief — instead of re-implementing `.kvw-table-state` markup
// inline four times.
//
// SORTING (DEV-16): `.kvw-table th.sortable[aria-sort]` + `.sort` indicator span, cited verbatim from
// web-components.css lines 178-180 + the library demo's live example (line 174:
// `<th class="sortable" aria-sort="descending">Listing <span class="sort">▾</span></th>`). A11y
// enhancement disclosed (not a silent deviation): the canon's plain clickable `<th>` (mouse-only, no
// visible interactive element) is wrapped here in an unstyled `<button>` so the sort control is keyboard-
// operable and has a focus-visible outline (gate 10) — visually identical to the canon (`.kvw-table-sort-
// btn` resets all button chrome), same class as `IsButton`-wrapping precedent DEV-15 already set for
// Button's `iconOnly` aria-label enforcement. `aria-sort` is applied ONLY to the active sorted column, per
// the WAI-ARIA table sort pattern and the canon's own single-active-column example (no other header in the
// demo carries `aria-sort`).
//
// SELECTION (DEV-16): `.kvw-col-check` header/row checkboxes + `.is-selected` row highlight + `.kvw-
// bulkbar` sticky bulk-action bar, cited verbatim from web-components.css lines 188/194/197-205 and the
// library demo lines 173/178-179/206 ("2 selected … Approve … Reject"). Verified real canon usage before
// building (gate 8's "don't invent" rule) — not assumed.
//
// ROW ACTIONS (DEV-16): `.kvw-row-kebab`, cited verbatim from web-components.css line 195-196 + demo lines
// 183/190/197 (`<button class="kvw-topbar-iconbtn kvw-row-kebab" aria-label="Row actions">⋮</button>`).
//
// STICKY HEADER: unchanged since DEV-15 (`.kvw-table th { position: sticky; inset-block-start: 0 }`,
// web-components.css line 172) — carried forward verbatim in this batch's CSS fragment below, confirmed
// still canon-true (checked against the current file, not assumed from the prior batch's own citation).
//
// PAGINATION HARDENING (Golden Law 11 — scale honesty, "the API must not permit offset-only assumptions"):
// unchanged prev/next + row-range-label API from DEV-15 (no numeric `page`/`pageNumber` prop exists
// anywhere in this file — grep-verifiable), now extended with an OPTIONAL `pageSize` control
// (`.kvw-pagesize`, web-components.css line 223-224 + demo lines 209/223) — safe under a keyset cursor
// (changing page size resets the cursor to the start of a fresh page, it does not imply random-offset
// jump-to-page-N; the canon's own numbered `.kvw-page-btn[aria-current="page"]` jump-to-page control
// remains the disclosed, deliberate DEV-15 deviation, NOT reintroduced here). Caller is responsible for
// resetting its cursor when sort or pageSize changes — documented on the relevant prop types below, not
// enforceable at the type level, so it is called out explicitly instead of silently assumed away.
//
// QA-FIX [DEV-18, 2026-07-24] — RSC BOUNDARY (real defect found by this batch's own consuming-app smoke
// test, not previously caught by DEV-15/16/17's typecheck-only gate): this component uses `React.useRef`/
// `React.useEffect` (the select-all checkbox's `indeterminate` wiring, below) but shipped with NO `'use
// client'` directive through DEV-17. A hook-using component with no client directive breaks (or silently
// never hydrates) when rendered inside a Next.js App Router Server Component tree — exactly the "package
// imports resolve in Next.js" proof this batch's brief asks for. Fixed forward by adding the directive
// above (Next.js/webpack's RSC compiler reads it as the file's literal first statement; `tsc` preserves a
// top-of-file string-literal expression statement unchanged through compilation, so the directive survives
// into `dist/`). See `dev18_report.md` for the full audit — `Drawer.tsx` had the identical latent bug
// (`React.useMemo`), fixed the same way.
import * as React from 'react';
import { EmptyState } from './EmptyState';

export interface DataTableColumn<Row> {
  key: string;
  /** Caller-resolved i18n text — never resolved in here (Law 3). */
  header: string;
  render: (row: Row) => React.ReactNode;
  align?: 'start' | 'end';
  /** Applies canon's `.cell-money`/`.num` end-alignment + tabular-numeral styling. */
  isMoney?: boolean;
  /** Renders the canon's `.sortable`/`.sort` header affordance (web-components.css lines 178-180). */
  sortable?: boolean;
}

export type DataTableSortDirection = 'ascending' | 'descending';

export interface DataTableSort {
  columnKey: string;
  direction: DataTableSortDirection;
}

export interface DataTablePageSize {
  value: number;
  options: readonly number[];
  onChange: (value: number) => void;
  /** Caller-i18n-resolved label (e.g. "Rows:") — never hardcoded English (Law 3). */
  label?: string;
  /** Accessible name for the `<select>` (Law 3 slot, gate 10 requirement). */
  selectAriaLabel: string;
}

export interface DataTablePagination {
  hasNextPage: boolean;
  hasPrevPage: boolean;
  onNext: () => void;
  onPrev: () => void;
  /** Caller-supplied, already-i18n-resolved range text (e.g. "1–20 of 143") — never computed/guessed here. */
  rangeLabel?: string;
  prevLabel?: string;
  nextLabel?: string;
  /** OPTIONAL rows-per-page control (`.kvw-pagesize`). Changing this must reset the caller's keyset cursor
   * — Golden Law 11; this component has no cursor of its own to reset, the caller owns that. */
  pageSize?: DataTablePageSize;
}

export interface DataTableSelection<Row> {
  /** Keys currently selected — caller-owned state, this component never mutates it. */
  selectedKeys: ReadonlySet<string>;
  onToggleRow: (rowKey: string, row: Row, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  /** Caller-i18n-resolved, e.g. `${n} selected` — never templated/pluralized in here (Law 3). */
  selectedLabel: (count: number) => string;
  /** Caller-i18n-resolved accessible names for the two checkbox roles. */
  selectAllLabel: string;
  selectRowLabel: (row: Row) => string;
  /** Bulk-action buttons rendered inside `.kvw-bulkbar` once ≥1 row is selected — fully caller-supplied
   * (e.g. `<Button>Approve</Button>`), this component owns zero business-action vocabulary. */
  bulkActions?: React.ReactNode;
}

export interface DataTableRowActions<Row> {
  /** Caller-i18n-resolved accessible name for the kebab button (same string for every row is fine — it is
   * a UI role name, "Row actions", not business vocabulary; Q52 does not apply to chrome labels). */
  label: string;
  onClick: (row: Row) => void;
}

export type DataTableState = 'default' | 'loading' | 'empty' | 'error' | 'denied' | 'flagged-off';
/** @deprecated DEV-16 renamed `status`→`state` and `populated`→`default` to match the design contract's own
 * §6 states vocabulary verbatim. Kept as a type alias only (zero real consumers existed to migrate — grep-
 * verified, see dev16_report.md) so any future accidental import of the old name still resolves. */
export type DataTableStatus = DataTableState;

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
  state: DataTableState;
  /** Accessible name for the table (rendered as a visually-hidden `<caption>`, gate 10). */
  caption: string;
  emptyTitle?: string;
  emptyBody?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  errorTitle?: string;
  errorBody?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Canon: "Permission needed … Ask your admin for the `payouts.read` permission" — no action button in
   * the canon's own denied-state example (`web-component-library.html` lines 230-233); this component
   * does not force one, but a caller may still pass `deniedActionLabel`/`onDeniedAction` if a future
   * screen genuinely needs one (e.g. a "Request access" flow) — optional, not invented as required. */
  deniedTitle?: string;
  deniedBody?: string;
  deniedActionLabel?: string;
  onDeniedAction?: () => void;
  /** Canon: `W128-tenant-listings-bulk.html` line 112 — no action, purely informational. */
  flaggedOffTitle?: string;
  flaggedOffBody?: string;
  /** Rows to render for the loading skeleton (default 5). */
  skeletonRowCount?: number;
  pagination?: DataTablePagination;
  sort?: DataTableSort;
  /** Fires with the FULL next sort (this component computes the ascending/descending toggle from the
   * current `sort` prop, mirroring the canon's single-active-column example) — the caller applies it to
   * its query and MUST reset its keyset cursor (Golden Law 11: a sort change is not a "next page"). */
  onSortChange?: (next: DataTableSort) => void;
  selection?: DataTableSelection<Row>;
  rowActions?: DataTableRowActions<Row>;
  className?: string;
}

function nextSortDirection(current: DataTableSort | undefined, columnKey: string): DataTableSortDirection {
  if (current?.columnKey === columnKey && current.direction === 'descending') return 'ascending';
  return 'descending'; // canon's own demo defaults a freshly-sorted column to descending (library line 174)
}

export function DataTable<Row>(props: DataTableProps<Row>): React.ReactElement {
  const {
    columns, rows, getRowKey, state, caption,
    emptyTitle, emptyBody, emptyActionLabel, onEmptyAction,
    errorTitle, errorBody, onRetry, retryLabel,
    deniedTitle, deniedBody, deniedActionLabel, onDeniedAction,
    flaggedOffTitle, flaggedOffBody,
    skeletonRowCount = 5, pagination, sort, onSortChange, selection, rowActions, className,
  } = props;

  const extraLeadingCols = (selection ? 1 : 0);
  const extraTrailingCols = (rowActions ? 1 : 0);
  const totalCols = columns.length + extraLeadingCols + extraTrailingCols;

  const allRowKeys = rows.map(getRowKey);
  const allSelected = selection ? allRowKeys.length > 0 && allRowKeys.every((k) => selection.selectedKeys.has(k)) : false;
  const someSelected = selection ? allRowKeys.some((k) => selection.selectedKeys.has(k)) : false;
  const selectAllRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  return (
    <div className={['kvw-table-wrap', className || ''].filter(Boolean).join(' ')}>
      <table className="kvw-table">
        <caption className="kvw-sr-only">{caption}</caption>
        <thead>
          <tr>
            {selection ? (
              <th className="kvw-col-check" scope="col">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label={selection.selectAllLabel}
                  checked={allSelected}
                  onChange={(e) => selection.onToggleAll(e.currentTarget.checked)}
                />
              </th>
            ) : null}
            {columns.map((col) => {
              const isSorted = sort?.columnKey === col.key;
              const thClass = [col.isMoney || col.align === 'end' ? 'num' : '', col.sortable ? 'sortable' : ''].filter(Boolean).join(' ');
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={thClass || undefined}
                  aria-sort={col.sortable && isSorted ? sort!.direction : undefined}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className="kvw-table-sort-btn"
                      onClick={() => onSortChange?.({ columnKey: col.key, direction: nextSortDirection(sort, col.key) })}
                    >
                      {col.header}
                      <span className="sort" aria-hidden="true">{isSorted && sort!.direction === 'ascending' ? '▴' : '▾'}</span>
                    </button>
                  ) : col.header}
                </th>
              );
            })}
            {rowActions ? <th scope="col"><span className="kvw-sr-only">{rowActions.label}</span></th> : null}
          </tr>
        </thead>
        <tbody aria-busy={state === 'loading' || undefined}>
          {state === 'loading' && Array.from({ length: skeletonRowCount }).map((_, i) => (
            <tr className="kvw-skeleton-row" key={`skeleton-${i}`}>
              {Array.from({ length: totalCols }).map((__, j) => (
                <td key={j}><span /></td>
              ))}
            </tr>
          ))}
          {state === 'empty' && (
            <tr>
              <td colSpan={totalCols}>
                <EmptyState
                  variant="empty"
                  title={emptyTitle ?? ''}
                  body={emptyBody}
                  actionLabel={emptyActionLabel}
                  onAction={onEmptyAction}
                />
              </td>
            </tr>
          )}
          {state === 'error' && (
            <tr>
              <td colSpan={totalCols}>
                <EmptyState
                  variant="error"
                  title={errorTitle ?? ''}
                  body={errorBody}
                  actionLabel={onRetry ? (retryLabel ?? 'Retry') : undefined}
                  onAction={onRetry}
                />
              </td>
            </tr>
          )}
          {state === 'denied' && (
            <tr>
              <td colSpan={totalCols}>
                <EmptyState
                  variant="denied"
                  title={deniedTitle ?? ''}
                  body={deniedBody}
                  actionLabel={deniedActionLabel}
                  onAction={onDeniedAction}
                />
              </td>
            </tr>
          )}
          {state === 'flagged-off' && (
            <tr>
              <td colSpan={totalCols}>
                <EmptyState variant="flagged-off" title={flaggedOffTitle ?? ''} body={flaggedOffBody} />
              </td>
            </tr>
          )}
          {state === 'default' && rows.map((row) => {
            const rowKey = getRowKey(row);
            const isSelected = selection ? selection.selectedKeys.has(rowKey) : false;
            return (
              <tr key={rowKey} className={isSelected ? 'is-selected' : undefined}>
                {selection ? (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={selection.selectRowLabel(row)}
                      checked={isSelected}
                      onChange={(e) => selection.onToggleRow(rowKey, row, e.currentTarget.checked)}
                    />
                  </td>
                ) : null}
                {columns.map((col) => (
                  <td key={col.key} className={col.isMoney ? 'cell-money' : col.align === 'end' ? 'num' : undefined}>
                    {col.render(row)}
                  </td>
                ))}
                {rowActions ? (
                  <td>
                    <button
                      type="button"
                      className="kvw-topbar-iconbtn kvw-row-kebab"
                      aria-label={rowActions.label}
                      onClick={() => rowActions.onClick(row)}
                    >
                      ⋮
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {selection && someSelected ? (
        <div className="kvw-bulkbar">
          {selection.selectedLabel(rows.filter((r) => selection.selectedKeys.has(getRowKey(r))).length)}
          {selection.bulkActions}
        </div>
      ) : null}
      {pagination ? (
        <div className="kvw-table-footer">
          {pagination.rangeLabel ? <span>{pagination.rangeLabel}</span> : null}
          {pagination.pageSize ? (
            <div className="kvw-pagesize">
              {pagination.pageSize.label ? <span>{pagination.pageSize.label}</span> : null}
              <select
                className="kvw-select"
                aria-label={pagination.pageSize.selectAriaLabel}
                value={pagination.pageSize.value}
                onChange={(e) => pagination.pageSize!.onChange(Number(e.currentTarget.value))}
              >
                {pagination.pageSize.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="kvw-pagination">
            <button
              type="button"
              className="kvw-page-btn"
              onClick={pagination.onPrev}
              disabled={!pagination.hasPrevPage}
              aria-label={pagination.prevLabel ?? 'Previous page'}
            >
              ‹
            </button>
            <button
              type="button"
              className="kvw-page-btn"
              onClick={pagination.onNext}
              disabled={!pagination.hasNextPage}
              aria-label={pagination.nextLabel ?? 'Next page'}
            >
              ›
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** CSS fragment. Table/toolbar/sort/selection/bulkbar/state/footer/pagesize selectors ported verbatim
 * from web-components.css lines 159-235. `.kvw-sr-only` IS a canon class (`web-components.css:476`) —
 * DEV-59 FIX: this file previously used a `kv-sr-only` prefix and its own comment claimed "not a canon
 * class," which DEV-58 QA found false (canon has an identical utility under the correct `kvw-` prefix;
 * `qa_dev58_audit.md` §1(b)). Renamed to the correct `kvw-` prefix and the CSS body's `clip: rect(...)`
 * argument syntax aligned to canon's exact (space-, not comma-, separated) form so this rule is now a
 * true byte-for-byte MATCH, not a mischaracterized CANON-MISSING entry. `.kvw-table-sort-btn` is a
 * DEV-16 a11y-enhancement class (see header comment) — resets all button chrome to render visually
 * identical to the canon's plain clickable `<th>`, zero new visual language introduced. */
export const dataTableStyles = `
.kvw-table-wrap {
  border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);
  background: var(--surface-card); overflow: auto; max-height: 640px;
}
.kvw-table { width: 100%; border-collapse: collapse; font-size: var(--web-text-table); }
.kvw-table th {
  position: sticky; inset-block-start: 0; z-index: 2;
  background: var(--table-header-bg); text-align: start;
  padding: var(--web-cell-pad-y) var(--web-cell-pad-x);
  font-size: var(--text-xs); font-weight: 600;
  color: var(--color-ink-500); border-block-end: 1px solid var(--border-default); white-space: nowrap;
}
.kvw-table th.sortable { cursor: pointer; }
.kvw-table th .sort { display: inline-block; margin-inline-start: var(--space-1); opacity: 0.4; }
.kvw-table th[aria-sort] .sort { opacity: 1; color: var(--color-primary-600); }
.kvw-table-sort-btn {
  background: none; border: none; padding: 0; margin: 0; font: inherit; color: inherit; cursor: pointer;
  display: inline-flex; align-items: center;
}
.kvw-table-sort-btn:focus-visible { outline: none; box-shadow: var(--web-focus-ring); border-radius: var(--radius-sm); }
.kvw-table td {
  padding: var(--web-cell-pad-y) var(--web-cell-pad-x);
  border-block-end: 1px solid var(--table-border);
  height: var(--web-row-h-dense); vertical-align: middle;
}
.kvw-table tbody tr:hover { background: var(--table-row-hover); }
.kvw-table tbody tr.is-selected { background: var(--table-row-selected); }
.kvw-table tbody tr:focus-within { box-shadow: inset 2px 0 0 var(--color-primary-600); }
[dir="rtl"] .kvw-table tbody tr:focus-within { box-shadow: inset -2px 0 0 var(--color-primary-600); }
.kvw-table .num { text-align: end; font-variant-numeric: tabular-nums; }
.kvw-table .cell-money { text-align: end; }
.kvw-col-check { width: 36px; }
.kvw-row-kebab { opacity: 0; }
.kvw-table tr:hover .kvw-row-kebab, .kvw-row-kebab:focus-visible { opacity: 1; }
.kvw-bulkbar {
  position: sticky; inset-block-end: 0; z-index: 3;
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--color-ink-800); color: var(--color-text-inverse); font-size: var(--text-sm);
  border-radius: var(--radius-md); margin: var(--space-2);
}
.kvw-bulkbar .kvw-btn { min-height: 28px; }
/* .kvw-table-state/.title/.body below are a byte-identical duplicate of the same 3 rules
   EmptyState.tsx's emptyStateStyles fragment owns (DataTable's 4 non-default states render via
   EmptyState now, not inline markup, but a consumer who imports ONLY dataTableStyles without
   EmptyState mounted elsewhere still needs these 3 rules available -- same disclosed-duplicate pattern
   DEV-15 already established for .kvw-badge-ai/.kvw-input-money: "safe to load twice, identical
   rules," concatenation in GlobalStyles.tsx produces no conflict). */
.kvw-table-state { padding: var(--space-10) var(--space-6); text-align: center; }
.kvw-table-state .title { font-weight: 700; margin-block-end: var(--space-1); }
.kvw-table-state .body { font-size: var(--text-sm); color: var(--color-ink-500); margin-block-end: var(--space-4); }
.kvw-skeleton-row td span {
  display: block; height: 12px; border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--color-earth-100), var(--color-earth-200), var(--color-earth-100));
  background-size: 200% 100%; animation: kvw-shimmer 1.4s infinite;
}
@keyframes kvw-shimmer { to { background-position: -200% 0; } }
.kvw-table-footer {
  display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-block-start: 1px solid var(--table-border);
  font-size: var(--text-xs); color: var(--color-ink-500);
  background: var(--surface-card); position: sticky; inset-block-end: 0;
}
.kvw-pagesize { display: flex; align-items: center; gap: var(--space-2); }
.kvw-pagesize .kvw-select { min-height: 28px; width: auto; font-size: var(--text-xs); }
.kvw-pagination { margin-inline-start: auto; display: flex; align-items: center; gap: var(--space-1); }
.kvw-page-btn {
  min-width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent;
  font-size: var(--text-xs); font-weight: 600; color: var(--color-ink-500); cursor: pointer;
}
.kvw-page-btn:hover { background: var(--color-earth-100); }
.kvw-page-btn:focus-visible { outline: none; box-shadow: var(--web-focus-ring); }
.kvw-page-btn[disabled] { opacity: 0.4; cursor: not-allowed; }
.kvw-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
`;
