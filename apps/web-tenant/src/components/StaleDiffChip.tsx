// apps/web-tenant/src/components/StaleDiffChip.tsx · PC-56 TENANT-SW-f · W318 §3 — the DIFF CHIP of verify-before-write.
//
// Rendered by a mutate chain's failure step when the server action's re-read found the row changed since the confirm screen showed it
// (`STALE_ROW`), or the confirm form carried no snapshot (`SEEN_MISSING`). "Changed while you were looking — field · was · now", then
// "Re-check and confirm again", which is the confirm step (it reads the row afresh). Nothing was written; nothing is replayed.
import type { FieldDiff } from '../features/mutate/verify';

export interface StaleLabels { title: string; seenMissing: string; field: string; was: string; now: string; recheck: string; nothingWritten: string }

export function StaleDiffChip({ code, diffs, labels, recheckHref }: { code: string; diffs: FieldDiff[]; labels: StaleLabels; recheckHref: string }) {
  return (
    <div className="kv-error kv-diffchip" role="alert" data-kv-stale-row={code}>
      <p><strong>{code === 'SEEN_MISSING' ? labels.seenMissing : labels.title}</strong> <code>{code}</code></p>
      {diffs.length > 0 && (
        <table className="kv-table kv-diffchip__table">
          <thead><tr><th scope="col">{labels.field}</th><th scope="col">{labels.was}</th><th scope="col">{labels.now}</th></tr></thead>
          <tbody>{diffs.map((d) => <tr key={d.field}><td><code>{d.field}</code></td><td>{d.was}</td><td><strong>{d.now}</strong></td></tr>)}</tbody>
        </table>
      )}
      <p className="kv-field__hint">{labels.nothingWritten}</p>
      <p><a href={recheckHref} className="kv-btn kv-btn--primary">{labels.recheck}</a></p>
    </div>
  );
}
