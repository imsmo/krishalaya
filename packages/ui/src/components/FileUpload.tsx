// packages/ui/src/components/FileUpload.tsx · DEV-18 (Phase D3, packages/ui port batch 4 — specialized
// components). Ports `.kvw-upload`/`.kvw-upload-item` verbatim from `web-components.css` lines 106-116,
// matching the real canon demo (`web-component-library.html` lines 111-113: a KYC-document dropzone +
// an already-uploaded `pan-card.jpg` row with a `kvw-badge-success` "verified" pill) — the founder's own
// brief candidate list names this "FileUpload/Dropzone if canon shows it (verify)"; verified real, not
// invented.
//
// HONEST MINIMUM (caller owns all upload logic — mirrors `Drawer`'s DEV-17 "caller owns interactive state"
// discipline exactly): this component does NOT perform any upload, does NOT read file bytes, does NOT
// validate file type/size — it is a pure drag-target + file-list PRESENTATION shell. `isDragOver` is a
// caller-supplied boolean (not internal state) and every drag/drop/browse event is a caller-supplied
// callback prop — this keeps the component fully controlled and testable without a real DOM drag simulation.
//
// 'use client' (Next.js RSC boundary — same DEV-18 audit class as `Modal.tsx`; see `dev18_report.md`): this
// component attaches real event-handler props (`onDragOver`/`onDragLeave`/`onDrop`/`onClick`/`onChange`) to
// native DOM elements. Per this batch's own RSC-boundary finding, ANY component wiring event-handler props
// onto a host element must be a Client Component (the handlers cannot survive server rendering otherwise) —
// declared here from the start, unlike `DataTable.tsx`/`Drawer.tsx` which this batch found missing it.
'use client';
import * as React from 'react';

export interface FileUploadProps {
  /** Caller-i18n-resolved instructional copy, e.g. "Drag KYC documents here, or **browse**" — a full slot,
   * never baked (Law 3; the canon's own bold "browse" word is caller-composed markup, not a fixed string
   * this component renders). */
  children: React.ReactNode;
  /** Caller-i18n-resolved constraint hint, e.g. "PDF/JPG up to 5MB". */
  hint?: React.ReactNode;
  /** Icon slot — canon's own demo uses an inline upload-arrow SVG; never baked here (a white-label tenant
   * or a future icon-sprite migration may want a different glyph). */
  icon?: React.ReactNode;
  /** Caller-OWNED drag-over visual state (`.is-dragover`) — this component has no internal state of its
   * own (see header comment). */
  isDragOver?: boolean;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  /** Fires when the dropzone itself is activated (click or Enter/Space via the `role="button"` affordance)
   * — the caller is responsible for opening its own file picker (e.g. a hidden `<input type="file">` it
   * owns), this component invents no file-input markup of its own since accepted MIME types/multiple-file
   * support are entirely a per-screen concern (canon shows only "PDF/JPG", a different screen may differ). */
  onActivate?: () => void;
  /** Accessible name for the dropzone region (gate 10 — a drag target has no implicit name). */
  label: string;
  className?: string;
}

/** `.kvw-upload` dropzone. Rendered as a real `role="button"` (keyboard-operable: Enter/Space fire
 * `onActivate`, same discipline as a native button) since canon's own drag target doubles as a click-to-
 * browse affordance (`web-component-library.html` line 111: "or **browse**"). */
export function FileUpload({ children, hint, icon, isDragOver, onDragOver, onDragLeave, onDrop, onActivate, label, className }: FileUploadProps): React.ReactElement {
  return (
    <div
      className={['kvw-upload', isDragOver ? 'is-dragover' : '', className || ''].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={label}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate?.();
        }
      }}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{children}</span>
      {hint ? <span className="kvw-upload-hint">{hint}</span> : null}
    </div>
  );
}

export interface FileUploadItemProps {
  /** Thumbnail image — canon's own demo uses a placeholder `<img>`; omit for a file type with no preview
   * (e.g. a PDF), this component never fabricates a generic-file icon fallback. */
  thumbnail?: React.ReactNode;
  /** Caller-i18n-resolved file name + meta line (e.g. "pan-card.jpg" / "240 KB · uploaded") — fully
   * caller-composed, this component owns zero file-size formatting logic (Law 3/12: no invented byte-to-
   * human-readable-size conversion here). */
  name: React.ReactNode;
  meta?: React.ReactNode;
  /** Status slot — canon's own demo renders a real `<StatusPill>`-shaped badge (`kvw-badge kvw-badge-
   * success`); left as a full slot rather than re-implementing that badge here (this package already ships
   * `StatusPill`/`Chip` — a caller composes one of those, avoiding a 3rd, competing badge implementation). */
  status?: React.ReactNode;
  className?: string;
}

/** `.kvw-upload-item` — an already-uploaded file row. */
export function FileUploadItem({ thumbnail, name, meta, status, className }: FileUploadItemProps): React.ReactElement {
  return (
    <div className={['kvw-upload-item', className || ''].filter(Boolean).join(' ')}>
      {thumbnail ? <span className="thumb">{thumbnail}</span> : null}
      <div className="kvw-upload-item-body">
        <strong>{name}</strong>
        {meta ? <div className="kvw-upload-item-meta">{meta}</div> : null}
      </div>
      {status ? <span className="kvw-upload-item-status">{status}</span> : null}
    </div>
  );
}

/** CSS fragment. `.kvw-upload`/`.kvw-upload-item`/`.thumb` ported verbatim from `web-components.css` lines
 * 106-116. `.kvw-upload-hint`/`.kvw-upload-item-body`/`-meta`/`-status` are engineering-addition layout
 * helpers (the canon's own demo achieves the same result with inline `style="font-size:var(--text-xs)"`/
 * `style="flex:1"` attributes — promoted to real classes here, same declarations, zero new value). */
export const fileUploadStyles = `
.kvw-upload {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-2);
  padding: var(--space-8) var(--space-4); text-align: center;
  border: 2px dashed var(--border-default); border-radius: var(--radius-lg);
  color: var(--color-ink-500); font-size: var(--text-sm); cursor: pointer;
}
.kvw-upload.is-dragover { border-color: var(--color-primary-600); background: var(--color-primary-50); }
.kvw-upload:focus-visible { outline: none; box-shadow: var(--web-focus-ring); }
.kvw-upload-hint { font-size: var(--text-xs); color: var(--color-ink-400); }
.kvw-upload-item { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; }
.kvw-upload-item .thumb { width: 40px; height: 40px; border-radius: var(--radius-sm); object-fit: cover; background: var(--color-earth-200); flex: none; }
.kvw-upload-item-body { flex: 1; min-width: 0; }
.kvw-upload-item-meta { font-size: var(--text-xs); color: var(--color-ink-400); }
`;
