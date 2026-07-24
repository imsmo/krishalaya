// packages/ui/src/components/Button.tsx · DEV-15 (Phase D3, packages/ui port batch 1).
// Ports canon classes `.kvw-btn` / `.kvw-btn-{primary,secondary,tertiary,danger,accent}` /
// `.kvw-btn-{lg,sm,icon}` / `.kvw-btn.is-pending` verbatim from
// `Phase-1 all screen design/Krishi_Verse_Design_System/system/web/web-components.css` lines 11-40.
// Values consumed from `../internal/theme` (packages/tokens-derived) — never a hand-typed hex/px here.
//
// Golden Law 9 (idempotency)/canon comment ("Pending spinner (idempotency law: disabled-while-pending)"):
// a `pending` button is DISABLED (pointer-events: none via CSS, `disabled` attribute set) so a double-tap
// cannot double-submit — this is a real behavioral guarantee, not just a visual spinner.
// Gate 10 (a11y): icon-only buttons (`iconOnly`) require an `aria-label` — enforced at the TYPE level below
// (TS will not compile a `<Button iconOnly>` without one), not just documented.
import * as React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'accent';
export type ButtonSize = 'md' | 'lg' | 'sm';

interface BaseButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Golden Law 9: while true, the button is disabled and shows the canon spinner (`.is-pending`). */
  pending?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

/** Icon-only rendering REQUIRES an accessible name (gate 10) — enforced by this discriminated union. */
export type ButtonProps =
  | (BaseButtonProps & { iconOnly?: false; children: React.ReactNode })
  | (BaseButtonProps & { iconOnly: true; 'aria-label': string; children: React.ReactNode });

const sizeClass: Record<ButtonSize, string> = { md: '', lg: 'kvw-btn-lg', sm: 'kvw-btn-sm' };

export function Button(props: ButtonProps): React.ReactElement {
  const {
    variant = 'primary', size = 'md', pending = false, iconOnly = false,
    leftIcon, rightIcon, className, disabled, children, type = 'button', ...rest
  } = props;

  const classes = [
    'kvw-btn',
    `kvw-btn-${variant}`,
    sizeClass[size],
    iconOnly ? 'kvw-btn-icon' : '',
    pending ? 'is-pending' : '',
    className || '',
  ].filter(Boolean).join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-kv-component="button"
    >
      {!pending && leftIcon}
      {!pending && children}
      {!pending && rightIcon}
    </button>
  );
}

/** CSS fragment, ported verbatim from web-components.css lines 11-40 (selectors/structure byte-identical);
 * variable VALUES come from `internal/theme.ts` (packages/tokens), never re-typed here. */
export const buttonStyles = `
.kvw-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
  min-height: var(--web-control-h); padding-inline: var(--space-4);
  border-radius: var(--radius-md); border: 1px solid transparent;
  font-family: inherit; font-size: var(--text-sm); font-weight: 600;
  cursor: pointer; text-decoration: none; white-space: nowrap;
  transition: background var(--duration-fast) var(--ease-out);
}
.kvw-btn:focus-visible { outline: none; box-shadow: var(--web-focus-ring); }
.kvw-btn[disabled] { opacity: 0.55; cursor: not-allowed; pointer-events: none; }
.kvw-btn-primary { background: var(--color-primary-600); color: var(--color-text-inverse); }
.kvw-btn-primary:hover { background: var(--color-primary-700); }
.kvw-btn-secondary { background: var(--surface-card); color: var(--color-ink-700); border-color: var(--border-default); }
.kvw-btn-secondary:hover { background: var(--color-earth-100); }
.kvw-btn-tertiary { background: transparent; color: var(--color-primary-600); }
.kvw-btn-tertiary:hover { background: var(--color-primary-50); }
.kvw-btn-danger { background: var(--color-danger); color: var(--color-text-inverse); }
.kvw-btn-danger:hover { background: var(--color-danger-dark); }
.kvw-btn-accent { background: var(--color-accent-500); color: var(--color-ink-800); }
.kvw-btn-lg { min-height: var(--web-control-h-lg); padding-inline: var(--space-6); font-size: var(--text-base); }
.kvw-btn-sm { min-height: 28px; padding-inline: var(--space-3); font-size: var(--text-xs); }
.kvw-btn-icon { padding-inline: 0; width: var(--web-control-h); }
.kvw-btn svg { width: 16px; height: 16px; }
.kvw-btn.is-pending { opacity: 0.55; cursor: not-allowed; pointer-events: none; }
.kvw-btn.is-pending::before {
  content: ""; width: 14px; height: 14px; border-radius: var(--radius-full);
  border: 2px solid currentColor; border-inline-start-color: transparent;
  animation: kvw-spin 0.8s linear infinite;
}
@keyframes kvw-spin { to { transform: rotate(360deg); } }
`;
