'use client';
// apps/web-tenant/src/components/MediaUploader.tsx · the listing photo uploader. This is the only client-side step
// of the media flow, and it touches NO secret and NO session token: the authed ticket-minting + confirm calls are
// Server Actions, and the raw bytes are PUT straight to the presigned S3 URL (never through our API). Per file:
//   1. read bytes → compute sha256 (Web Crypto) + image dimensions in the browser
//   2. requestUploadAction({ kind:'image', mimeType, declaredBytes }) → presigned ticket (Server Action, authed)
//   3. PUT the bytes to ticket.uploadUrl (S3, cross-origin, tokenless)
//   4. confirmUploadAction(mediaId, { bytes, sha256, width, height }) → confirmed
//   5. push the confirmed mediaId into state → render a hidden <input name="mediaIds"> the form submits
// Fail-closed: any step that throws marks that file 'failed' with a retry/remove affordance; the listing can
// still be created without photos. The server re-validates every asset (scan + ownership) regardless.
import { useCallback, useRef, useState } from 'react';
import { requestUploadAction, confirmUploadAction } from '../app/listings/new/actions';

type Item = { localId: string; name: string; status: 'uploading' | 'done' | 'failed'; mediaId?: string };

// PC-56 TENANT-7b: the lesson form uploads a VIDEO (MP4/MOV), an AUDIO file or a PDF through the same three steps; the
// MIME lists mirror `core/media`'s allow-list per kind, and dimensions are read for images only.
const ACCEPT_BY_KIND: Record<'image' | 'video' | 'audio' | 'document', string> = {
  image: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4,video/quicktime',
  audio: 'audio/mpeg,audio/mp4,audio/ogg',
  document: 'application/pdf',
};

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function imageDims(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

export function MediaUploader({ labels, fieldName = 'mediaIds', single = false, kind = 'image', inputId = 'media' }: {
  labels: { add: string; hint: string; uploading: string; failed: string; remove: string };
  /** The media kind this uploader mints tickets for (default image). */
  kind?: 'image' | 'video' | 'audio' | 'document';
  /** The file input's id, so two uploaders on one page do not share a label. */
  inputId?: string;
  /** Name of the hidden input(s) the confirmed mediaIds are submitted under (default 'mediaIds'). */
  fieldName?: string;
  /** When true, only one photo is kept (e.g. a single proof-of-delivery image). */
  single?: boolean;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    const localId = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setItems((prev) => [...(single ? [] : prev), { localId, name: file.name, status: 'uploading' }]);
    try {
      const buf = await file.arrayBuffer();
      const [sha, dims] = await Promise.all([sha256Hex(buf), kind === 'image' ? imageDims(file) : Promise.resolve({} as { width?: number; height?: number })]);
      const ticket = await requestUploadAction({ kind, mimeType: file.type, declaredBytes: file.size });
      const put = await fetch(ticket.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error(`upload failed: ${put.status}`);
      const confirmed = await confirmUploadAction(ticket.mediaId, { bytes: file.size, sha256: sha, width: dims.width, height: dims.height });
      setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: 'done', mediaId: confirmed.mediaId } : it)));
    } catch {
      setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: 'failed' } : it)));
    }
  }, [kind, single]);

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = ''; // allow re-picking the same file
    files.forEach((f) => { void upload(f); });
  }, [upload]);

  const remove = useCallback((localId: string) => setItems((prev) => prev.filter((it) => it.localId !== localId)), []);

  return (
    <div className="kv-uploader">
      <input ref={inputRef} id={inputId} type="file" accept={ACCEPT_BY_KIND[kind]} multiple={!single} className="kv-input" onChange={onPick} aria-describedby={`${inputId}-hint`} aria-label={labels.add} />
      <p id={`${inputId}-hint`} className="kv-field__hint">{labels.hint}</p>
      <ul className="kv-upload-list">
        {items.map((it) => (
          <li key={it.localId} className={`kv-upload-tile${it.status === 'failed' ? ' kv-upload-tile--error' : ''}`}>
            <span className="kv-upload-name">{it.name}</span>
            <span className="kv-upload-status" aria-live="polite">
              {it.status === 'uploading' ? labels.uploading : it.status === 'failed' ? labels.failed : '✓'}
            </span>
            <button type="button" className="kv-upload-remove" onClick={() => remove(it.localId)} aria-label={labels.remove}>×</button>
            {it.status === 'done' && it.mediaId && <input type="hidden" name={fieldName} value={it.mediaId} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
