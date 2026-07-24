'use client';
// packages/ui/src/GlobalStyles.tsx · DEV-15 (Phase D3, packages/ui port batch 1).
//
// Single injection point for every atom's CSS. Zero build-step CSS pipeline exists in `packages/ui`
// (grep-verified: no CSS-Modules/styled-components/PostCSS config anywhere in the package or its
// tsconfig) and Next.js apps ship these components pre-compiled (`apps/web-tenant/next.config.js`'s own
// header comment: workspace packages "ship PRE-COMPILED CommonJS in their dist/"). A plain JSX `<style>`
// tag is SSR-safe (no DOM mutation, no hydration mismatch — the string is identical server and client) and
// needs no bundler CSS support at all, unlike a `.css` file import.
//
// INTEGRATION REQUIREMENT (packages/ui had zero consumers before this batch — grep-verified, this is the
// right time to establish this contract without breaking anyone): a consuming app renders
// `<KvUiGlobalStyles />` ONCE, near its root layout (e.g. `app/layout.tsx`'s `<head>`), before any atom
// from this package is used. This is documented in `dev15_report.md`.
//
// QA-FIX [DEV-18, 2026-07-24] — RSC BOUNDARY (a real defect found by this batch's own consuming-app smoke
// test in a live `next build`, not by typecheck): this file imports plain-string CSS-fragment constants
// (`dataTableStyles`, `drawerStyles`, `modalStyles`, `fileUploadStyles`) from component files that this
// SAME batch just marked `'use client'` (see those files' own QA-FIX comments). Once a module carries
// `'use client'`, Next.js's RSC compiler treats EVERY export from it — even a plain string constant, not
// just the component — as a client-module reference that a Server Component may only pass through, never
// read the VALUE of directly. This file's `allComponentStyles` array does `.join('\n')` on those strings —
// a real value-level read — which a Server Component is not allowed to do, producing the exact build-time
// failure this smoke test caught: "Cannot access dataTableStyles.toString on the server. You cannot dot
// into a client module from a server component." Fixed forward the same way as any other component needing
// real interactivity or client-only value access: this file itself becomes a Client Component. Rendering
// `<KvUiGlobalStyles />` from a Server Component layout (as `apps/web-tenant/src/app/layout.tsx` does) is
// unaffected — Server Components may always render a Client Component's ELEMENT, this constraint is
// specifically about reading a client module's exported VALUES directly, which this file needs to do (the
// `<style>` tag's static string content), not merely reference it as a child.
import * as React from 'react';
import { lightVars, darkVars, toCssVarBlock } from './internal/theme';
import { buttonStyles } from './components/Button';
import { inputStyles } from './components/Input';
import { statusPillStyles } from './components/StatusPill';
import { aiBadgeStyles } from './components/AiBadge';
import { moneyTextStyles } from './components/MoneyText';
import { dataTableStyles } from './components/DataTable';
import { emptyStateStyles } from './components/EmptyState';
import { kpiCardStyles } from './components/KpiCard';
import { calloutStyles } from './components/Callout';
import { chipStyles } from './components/Chip';
import { skeletonStyles } from './components/Skeleton';
import { appShellStyles } from './components/AppShell';
import { sidebarStyles } from './components/Sidebar';
import { topbarStyles } from './components/Topbar';
import { breadcrumbsStyles } from './components/Breadcrumbs';
import { pageHeaderStyles } from './components/PageHeader';
import { tabsStyles } from './components/Tabs';
import { drawerStyles } from './components/Drawer';
import { treeViewStyles } from './components/TreeView';
import { dateRangePickerStyles } from './components/DateRangePicker';
import { modalStyles } from './components/Modal';
import { toastStyles } from './components/Toast';
import { diffViewerStyles } from './components/DiffViewer';
import { wizardStyles } from './components/Wizard';
import { fileUploadStyles } from './components/FileUpload';
import { toolbarStyles } from './components/Toolbar';

// DEV-16: appended 5 new data-display fragments (EmptyState/KpiCard/Callout/Chip/Skeleton). Several
// contain disclosed byte-identical duplicate rules with DataTable's own fragment (`.kvw-table-state`,
// `.kvw-card`, the `kvw-shimmer` keyframe) — each duplicate is commented at its source, same "safe to
// load twice, identical rules" precedent DEV-15 established for `.kvw-badge-ai`/`.kvw-input-money`.
// DEV-17: appended 9 new navigation/layout fragments (AppShell/Sidebar/Topbar/Breadcrumbs/PageHeader/
// Tabs/Drawer/TreeView/DateRangePicker). Several also carry disclosed byte-identical duplicates
// (`.kvw-badge*` in Sidebar, `.kvw-avatar*` in Topbar, `.icon-mirrors` in DateRangePicker) — same
// precedent, each commented at its own source file.
// DEV-18: appended 6 new specialized-component fragments (Modal/Toast/DiffViewer/Wizard/FileUpload/
// Toolbar). `Modal` re-declares `.kvw-backdrop` (byte-identical to `Drawer.tsx`'s own citation of the same
// canon rule — safe to load twice, same precedent) since both components share that class name but at
// DIFFERENT correct z-index contexts (Drawer disclosed its own `.kvw-drawer-backdrop` override at DEV-17;
// Modal reuses `.kvw-backdrop` unmodified, see `Modal.tsx`'s own header comment for why that's correct here).
const allComponentStyles = [
  buttonStyles, inputStyles, statusPillStyles, aiBadgeStyles, moneyTextStyles, dataTableStyles,
  emptyStateStyles, kpiCardStyles, calloutStyles, chipStyles, skeletonStyles,
  appShellStyles, sidebarStyles, topbarStyles, breadcrumbsStyles, pageHeaderStyles, tabsStyles,
  drawerStyles, treeViewStyles, dateRangePickerStyles,
  modalStyles, toastStyles, diffViewerStyles, wizardStyles, fileUploadStyles, toolbarStyles,
].join('\n');

export const kvUiCss = [
  toCssVarBlock(':root', lightVars),
  toCssVarBlock('[data-theme="dark"]', darkVars),
  allComponentStyles,
].join('\n\n');

/** Render once per page/app. See this file's header comment for the integration requirement. */
export function KvUiGlobalStyles(): React.ReactElement {
  // Static, package-authored CSS string only (built from `internal/theme.ts` + each component's own
  // exported style fragment) — no user/request input ever flows into this value.
  return <style id="kv-ui-styles" dangerouslySetInnerHTML={{ __html: kvUiCss }} />;
}
