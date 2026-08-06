'use client';
// apps/web-gov/src/components/VisitEvidence.tsx · GW-4 field-visit evidence capture (PC-55 B1, canon W337).
// The ONLY client-side step of the gov media flow, and it holds no secret and no session token: the authed
// ticket-mint and confirm are Server Actions, and the raw bytes are PUT straight to the presigned S3 URL — never
// through our API. Per photo: sha256 + dimensions in the browser → ticket → PUT → confirm → hidden input carrying
// the confirmed mediaId, which is what the visit submission actually references (evidence rides MEDIA IDS).
//
// LOCATION IS RECORDED ONCE FOR THE VISIT AND STAMPED ON EVERY PHOTO. The browser cannot reliably read EXIF GPS
// out of each file, and inventing a per-photo coordinate we never measured would be a fabricated fact inside an
// evidence record. So the officer captures (or types) the location of the visit and the hint says exactly that.
// "Use my location" uses the device's own geolocation with the officer's explicit consent; refusing it is fine —
// the fields stay typeable.
//
// Fail-closed: any failed photo is marked failed and contributes NO mediaId, so a half-uploaded evidence set can
// never be submitted as if it were complete. The server re-validates every asset (scan + ownership) regardless.
import { useCallback, useRef, useState } from 'react';
import { requestUploadAction, confirmUploadAction } from '../app/schemes/actions';

type Item = { localId: string; name: string; status: 'uploading' | 'done' | 'failed'; mediaId?: string };

const ACCEPT = 'image/jpeg,image/png,image/webp';

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

export interface VisitEvidenceLabels {
  photos: string; photosHint: string; uploading: string; failed: string; remove: string;
  lat: string; lng: string; useLocation: string; locationHint: string; locationDenied: string;
  capturedAt: string; capturedAtHint: string;
}

export function VisitEvidence({ labels }: { labels: VisitEvidenceLabels }) {
  const [items, setItems] = useState<Item[]>([]);
  const [geoError, setGeoError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    const localId = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setItems((prev) => [...prev, { localId, name: file.name, status: 'uploading' }]);
    try {
      const buf = await file.arrayBuffer();
      const [sha, dims] = await Promise.all([sha256Hex(buf), imageDims(file)]);
      const ticket = await requestUploadAction({ kind: 'image', mimeType: file.type, declaredBytes: file.size });
      const put = await fetch(ticket.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error(`upload failed: ${put.status}`);
      const confirmed = await confirmUploadAction(ticket.mediaId, { bytes: file.size, sha256: sha, width: dims.width, height: dims.height });
      setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: 'done', mediaId: confirmed.mediaId } : it)));
    } catch {
      setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: 'failed' } : it)));
    }
  }, []);

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = '';
    files.forEach((f) => { void upload(f); });
  }, [upload]);

  const remove = useCallback((localId: string) => setItems((prev) => prev.filter((it) => it.localId !== localId)), []);

  const useLocation = useCallback(() => {
    setGeoError(false);
    if (!navigator.geolocation) { setGeoError(true); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (latRef.current) latRef.current.value = pos.coords.latitude.toFixed(6);
        if (lngRef.current) lngRef.current.value = pos.coords.longitude.toFixed(6);
      },
      () => setGeoError(true),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  return (
    <div className="kv-uploader">
      <label htmlFor="visit-photos" className="kv-field__label">{labels.photos}</label>
      <input ref={inputRef} id="visit-photos" type="file" accept={ACCEPT} multiple className="kv-input" onChange={onPick} aria-describedby="visit-photos-hint" />
      <p id="visit-photos-hint" className="kv-field__hint">{labels.photosHint}</p>
      <ul className="kv-upload-list">
        {items.map((it) => (
          <li key={it.localId} className={`kv-upload-tile${it.status === 'failed' ? ' kv-upload-tile--error' : ''}`}>
            <span className="kv-upload-name">{it.name}</span>
            <span className="kv-upload-status" aria-live="polite">
              {it.status === 'uploading' ? labels.uploading : it.status === 'failed' ? labels.failed : '✓'}
            </span>
            <button type="button" className="kv-upload-remove" onClick={() => remove(it.localId)} aria-label={labels.remove}>×</button>
            {it.status === 'done' && it.mediaId && <input type="hidden" name="mediaIds" value={it.mediaId} />}
          </li>
        ))}
      </ul>

      <div className="kv-field">
        <label htmlFor="visit-lat" className="kv-field__label">{labels.lat}</label>
        <input ref={latRef} id="visit-lat" name="lat" className="kv-input" inputMode="decimal" required />
        <label htmlFor="visit-lng" className="kv-field__label">{labels.lng}</label>
        <input ref={lngRef} id="visit-lng" name="lng" className="kv-input" inputMode="decimal" required />
        <button type="button" className="kv-btn kv-btn--muted kv-btn--sm" onClick={useLocation}>{labels.useLocation}</button>
        <p className="kv-field__hint">{labels.locationHint}</p>
        {geoError && <p className="kv-error" role="alert">{labels.locationDenied}</p>}
      </div>

      <div className="kv-field">
        <label htmlFor="visit-at" className="kv-field__label">{labels.capturedAt}</label>
        <input id="visit-at" name="capturedAt" type="datetime-local" className="kv-input" required aria-describedby="visit-at-hint" />
        <p id="visit-at-hint" className="kv-field__hint">{labels.capturedAtHint}</p>
      </div>
    </div>
  );
}
