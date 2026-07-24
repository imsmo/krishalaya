// packages/ui/src/index.ts · DEV-15 (Phase D3, packages/ui port batch 1) — public barrel.
// Render `<KvUiGlobalStyles />` once near your app root before using any component below (see
// `GlobalStyles.tsx`'s header comment for why, and `dev15_report.md` for the integration note).
export { KvUiGlobalStyles, kvUiCss } from './GlobalStyles';

export { Button } from './components/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/Button';

export { Input } from './components/Input';
export type { InputProps, InputMoneyAffix } from './components/Input';

export { StatusPill } from './components/StatusPill';
export type { StatusPillProps, StatusTone } from './components/StatusPill';

export { AiBadge } from './components/AiBadge';
export type { AiBadgeProps, AiBadgeVariant } from './components/AiBadge';

export { MoneyText } from './components/MoneyText';
export type { MoneyTextProps } from './components/MoneyText';

export { DataTable } from './components/DataTable';
export type {
  DataTableProps, DataTableColumn, DataTablePagination, DataTablePageSize,
  DataTableState, DataTableStatus, DataTableSort, DataTableSortDirection,
  DataTableSelection, DataTableRowActions,
} from './components/DataTable';

// --- DEV-16 (Phase D3, packages/ui port batch 2 — data display siblings) ---
export { EmptyState } from './components/EmptyState';
export type { EmptyStateProps, EmptyStateVariant } from './components/EmptyState';

export { KpiCard } from './components/KpiCard';
export type { KpiCardProps, KpiDeltaDirection } from './components/KpiCard';

export { Callout } from './components/Callout';
export type { CalloutProps, CalloutTone } from './components/Callout';

export { Chip } from './components/Chip';
export type { ChipProps } from './components/Chip';

export { Skeleton } from './components/Skeleton';
export type { SkeletonProps } from './components/Skeleton';

// --- DEV-17 (Phase D3, packages/ui port batch 3 — navigation/layout primitives) ---
export { AppShell, ImpersonationBanner } from './components/AppShell';
export type { AppShellProps, ImpersonationBannerProps, RealmKind } from './components/AppShell';

export { Sidebar } from './components/Sidebar';
export type { SidebarProps, SidebarNavItem, SidebarNavSection, SidebarNavBadge } from './components/Sidebar';

export { Topbar, Avatar } from './components/Topbar';
export type { TopbarProps, TopbarNotification, AvatarProps } from './components/Topbar';

export { Breadcrumbs } from './components/Breadcrumbs';
export type { BreadcrumbsProps, BreadcrumbItem } from './components/Breadcrumbs';

export { PageHeader } from './components/PageHeader';
export type { PageHeaderProps } from './components/PageHeader';

export { Tabs, nextTabKey } from './components/Tabs';
export type { TabsProps, TabItem, TabMoveKey } from './components/Tabs';

export { Drawer, isCloseKey } from './components/Drawer';
export type { DrawerProps } from './components/Drawer';

export { TreeView } from './components/TreeView';
export type { TreeViewProps, TreeNode } from './components/TreeView';

export { DateRangePicker } from './components/DateRangePicker';
export type { DateRangePickerProps, DateRangePreset } from './components/DateRangePicker';

// --- DEV-18 (Phase D3, packages/ui port batch 4 — specialized components + real consuming-app smoke test) ---
export { Modal, getFocusableElements, shouldWrapFocus } from './components/Modal';
export type { ModalProps } from './components/Modal';

export { Toast } from './components/Toast';
export type { ToastProps } from './components/Toast';

export { DiffViewer } from './components/DiffViewer';
export type {
  DiffViewerProps, DiffViewerInlineProps, DiffViewerSplitProps,
  DiffLine, DiffToken, DiffInlineLineType, DiffSplitLineType,
} from './components/DiffViewer';

export { Wizard, Stepper } from './components/Wizard';
export type { WizardProps, StepperProps, WizardStep } from './components/Wizard';

export { FileUpload, FileUploadItem } from './components/FileUpload';
export type { FileUploadProps, FileUploadItemProps } from './components/FileUpload';

export { Toolbar } from './components/Toolbar';
export type { ToolbarProps } from './components/Toolbar';

// --- DEV-19 (Phase D4, "implement the 4 UI mechanisms" batch) — pure mechanism resolvers, consumed by each
// app's own cookie-reading `lib/*.ts` (see dev19_report.md's SSR-strategy section for why these stay
// framework-agnostic rather than importing next/headers directly). CSS fragments are already wired into
// `KvUiGlobalStyles` (see GlobalStyles.tsx) — re-exported here too for apps that want to consume the raw
// fragment string without pulling in the whole component library's CSS (e.g. web-admin/web-partner, which
// don't render `<KvUiGlobalStyles />` at all — see those apps' own layout.tsx wiring).
export {
  parseThemePreference, resolveThemeHtmlAttrs, THEME_PREFERENCES,
} from './mechanisms/theme';
export type { ThemePreference, ThemeHtmlAttrs } from './mechanisms/theme';

export { isSeniorOn, seniorConsoleStyles } from './mechanisms/seniorMode';
export { densityStyles } from './mechanisms/density';
