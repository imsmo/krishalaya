// packages/ui/src/components/PageHeader.tsx · DEV-17 (Phase D3, packages/ui port batch 3 —
// navigation/layout primitives). Ports `.kvw-page-header`/`.kvw-page-title`/`.kvw-page-sub`/
// `.kvw-page-actions` verbatim from `web-frame.css` lines 159-168, matching the real canon demo
// (`web-component-library.html` line 152: title + sub + a single primary action button).
import * as React from 'react';

export interface PageHeaderProps {
  /** Caller-i18n-resolved page title (Law 3). */
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps): React.ReactElement {
  return (
    <header className={['kvw-page-header', className || ''].filter(Boolean).join(' ')}>
      <div>
        <h1 className="kvw-page-title">{title}</h1>
        {subtitle ? <p className="kvw-page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="kvw-page-actions">{actions}</div> : null}
    </header>
  );
}

/** CSS fragment ported verbatim from `web-frame.css` lines 159-172 (incl. `.kvw-section-title`, the
 * PageHeader family's own in-page sub-heading, and the `<=768px` stacking rule, line 205-206). */
export const pageHeaderStyles = `
.kvw-page-header {
  display: flex; align-items: flex-start; gap: var(--space-4);
  margin-block-end: var(--space-6);
}
.kvw-page-title {
  font-family: var(--font-display); font-size: var(--web-text-page-title);
  font-weight: 700; letter-spacing: -0.01em; margin: 0; color: var(--color-ink-700);
}
.kvw-page-sub { margin: var(--space-1) 0 0; color: var(--color-ink-500); font-size: var(--text-sm); }
.kvw-page-actions { margin-inline-start: auto; display: flex; gap: var(--space-3); flex: none; }
.kvw-section-title {
  font-family: var(--font-display); font-size: var(--web-text-section);
  font-weight: 600; margin: var(--space-8) 0 var(--space-4);
}
@media (max-width: 768px) {
  .kvw-page-header { flex-direction: column; }
  .kvw-page-actions { margin-inline-start: 0; }
}
`;
