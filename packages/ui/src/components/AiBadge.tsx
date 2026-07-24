// packages/ui/src/components/AiBadge.tsx · DEV-15 (Phase D3, packages/ui port batch 1).
//
// `chip` variant ports canon `.kvw-badge.kvw-badge-ai` verbatim — the ONLY AI-web pattern that actually
// exists in `system/web/web-components.css` (grep-verified, zero hits for any dedicated AI-banner
// selector). HAND-2's component library demonstrates it at
// `system/web/web-component-library.html:125`: `<span class="kvw-badge kvw-badge-ai"><span class="dot">
// </span>AI graded</span>`.
//
// `banner` variant is an ENGINEERING EXTENSION, not a canon port — disclosed here and in the DEV-15 STATE
// block / report, not silently shipped as "ported." Golden Law 7 ("Every AI surface carries the
// non-dismissible 'AI can be wrong' banner + confidence honesty") requires this surface to exist
// regardless of whether the web design canon has authored a dedicated class for it yet. Built from
// ratified AI-semantic tokens only (`--color-ai-light`/`--color-ai-dark`, spacing/radii) — no new hex, no
// new pixel value invented. Per contract §8 this is an ESCALATION ("any new component/pattern that
// doesn't exist in the ported design system yet") — filed as a DELTA candidate for founder/design routing
// in `dev15_report.md`, not presented as a plain port.
//
// Law 7 is enforced structurally, not just by convention:
//  - `banner` has NO dismiss affordance in its props or markup at all — there is no `onDismiss`/`onClose`
//    prop to pass, so a consuming screen cannot accidentally make it dismissible.
//  - `confidence` is optional; when omitted the banner renders the honest "needs review" copy instead of
//    inventing a percentage — mirrors Law 7's "degrades to 'needs review', never a fake confident answer."
import * as React from 'react';

export type AiBadgeVariant = 'chip' | 'banner';

interface AiBadgeChipProps {
  variant?: 'chip';
  /** Caller-supplied, already-i18n-resolved text (e.g. "AI graded") — never hardcoded in here (Law 3). */
  label: string;
}

interface AiBadgeBannerProps {
  variant: 'banner';
  /** Caller-supplied, already-i18n-resolved headline (e.g. "AI-assisted grading"). */
  label: string;
  /** Caller-supplied, already-i18n-resolved disclosure body (e.g. "This grade was estimated by AI and may
   * be wrong — a human review is always available."). Never a default is invented here: honesty text is
   * the calling screen's own copy, exactly like `label`. */
  disclosureText: string;
  /** 0–1. Omit if genuinely unknown — the component will NOT invent a number (Law 7). */
  confidence?: number;
  /** Caller-supplied, already-i18n-resolved fallback shown only when `confidence` is omitted. */
  needsReviewText?: string;
}

export type AiBadgeProps = AiBadgeChipProps | AiBadgeBannerProps;

export function AiBadge(props: AiBadgeProps): React.ReactElement {
  if (props.variant === 'banner') {
    const { label, disclosureText, confidence, needsReviewText } = props;
    return (
      <div className="kvw-ai-banner" role="status" data-kv-component="ai-badge-banner">
        <span className="kvw-ai-banner-icon" aria-hidden="true">✦</span>
        <div className="kvw-ai-banner-body">
          <p className="kvw-ai-banner-label">{label}</p>
          <p className="kvw-ai-banner-text">{disclosureText}</p>
          {typeof confidence === 'number' ? (
            <p className="kvw-ai-banner-confidence">{Math.round(confidence * 100)}%</p>
          ) : needsReviewText ? (
            <p className="kvw-ai-banner-confidence kvw-ai-banner-confidence--unknown">{needsReviewText}</p>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <span className="kvw-badge kvw-badge-ai" data-kv-component="ai-badge-chip">
      <span className="dot" aria-hidden="true" />
      {props.label}
    </span>
  );
}

/** CSS: the `.kvw-badge-ai` selectors are a byte-identical port of web-components.css lines 121-133 (shared
 * with StatusPill — safe to load twice, identical rules). `.kvw-ai-banner*` is the engineering-extension
 * block described above, built only from existing `--color-ai-*`/`--space-*`/`--radius-*` tokens. */
export const aiBadgeStyles = `
.kvw-badge {
  display: inline-flex; align-items: center; gap: var(--space-1);
  padding: 2px var(--space-2); border-radius: var(--radius-full);
  font-size: var(--text-xs); font-weight: 600; line-height: 1.6;
  background: var(--color-earth-200); color: var(--color-ink-600);
}
.kvw-badge svg, .kvw-badge .dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: currentColor; }
.kvw-badge-ai { background: var(--color-ai-light); color: var(--color-ai-dark); }
[data-theme="dark"] .kvw-badge-ai { color: var(--color-ai-text-dark); }

/* ENGINEERING EXTENSION (not canon-ported — see this file's header comment / DELTA candidate) */
.kvw-ai-banner {
  display: flex; align-items: flex-start; gap: var(--space-3);
  padding: var(--space-4); border-radius: var(--radius-lg);
  background: var(--color-ai-light); color: var(--color-ai-dark);
  border: 1px solid var(--color-ai-dark);
}
.kvw-ai-banner-icon { font-size: var(--text-base); line-height: 1; }
.kvw-ai-banner-label { margin: 0; font-weight: 700; font-size: var(--text-sm); }
.kvw-ai-banner-text { margin: var(--space-1) 0 0; font-size: var(--text-xs); }
.kvw-ai-banner-confidence { margin: var(--space-1) 0 0; font-size: var(--text-xs); font-weight: 600; }
.kvw-ai-banner-confidence--unknown { font-style: italic; font-weight: 500; }
[data-theme="dark"] .kvw-ai-banner { color: var(--color-ai-text-dark); }
`;
