'use client';
// apps/web-storefront/src/components/offline/StorageLine.tsx · PC-56 STORE-6a · W319 "storage" — what this site keeps on THIS phone, measured by
// the phone itself (`navigator.storage.estimate()`, when the browser offers it), rounded; never a number this page makes up. Before the
// measure (or without one) the line says it cannot tell. "Photos are never kept" is printed beside it by the page (founder D3).
import { useEffect, useState } from 'react';

export interface StorageLabels { uses: string; unknown: string }

/** Rounded megabytes for the line: one decimal under 10 MB, whole numbers above; never below 0.1 for a non-zero use. */
export function roundMb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0';
  const mb = bytes / (1024 * 1024);
  if (mb < 10) return String(Math.max(0.1, Math.round(mb * 10) / 10));
  return String(Math.round(mb));
}

/** PURE view. */
export function StorageLineView({ bytes, labels }: { bytes: number | null; labels: StorageLabels }) {
  return <p className="kv-field__hint" data-kv-storage={bytes === null ? 'unknown' : 'measured'}>{bytes === null ? labels.unknown : labels.uses.replace('{mb}', roundMb(bytes))}</p>;
}

export function StorageLine({ labels }: { labels: StorageLabels }) {
  const [bytes, setBytes] = useState<number | null>(null);
  useEffect(() => {
    const est = typeof navigator !== 'undefined' ? navigator.storage?.estimate : undefined;
    if (!est) return;
    navigator.storage.estimate().then((e) => setBytes(typeof e.usage === 'number' ? e.usage : null)).catch(() => setBytes(null));
  }, []);
  return <StorageLineView bytes={bytes} labels={labels} />;
}
