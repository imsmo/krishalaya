'use client';
// apps/web-storefront/src/components/drafts/DraftDone.tsx · PC-56 STORE-6b · D4 / C2 — THE ACT SUCCEEDED: THE DRAFT GOES. Rendered by a live page on
// its SUCCESS render only — the thread after a post (`?status=sent`), the order page after a review was published (`?status=reviewed`, W3146),
// the review page after an edit was saved (`?ok=updated`, W3143). It deletes this person's draft for that (kind, ref) from this phone — the
// drafts saved at or before this page rendered (words typed AFTER it are a new draft and stay) — and leaves a hidden marker so the page's own
// keeper (the composer is on the same page) fills nothing. Client-side only; no server call; nothing at all without JavaScript.
import { useEffect } from 'react';
import { doneRemovals, type DraftKind } from '../../features/store6b/drafts';
import { announce, settlePhone } from './phone';

/** PURE view: the marker the keeper looks for. */
export function DraftDoneView({ kind, refId }: { kind: DraftKind; refId: string }) {
  return <p hidden data-kv-draft-done="" data-kv-draft-kind={kind} data-kv-draft-ref={refId} />;
}

export function DraftDone({ kind, slug, refId, renderedAt }: { kind: DraftKind; slug: string; refId: string; renderedAt: string }) {
  useEffect(() => {
    let stopped = false;
    const at = Date.parse(renderedAt);
    settlePhone().then(async (p) => {
      if (stopped || !p) return;
      const ids = doneRemovals(p.kept.filter((d) => d.owner === p.owner && d.slug === slug), kind, refId, Number.isFinite(at) ? at : Date.now());
      let changed = false;
      for (const id of ids) { const r = await p.store.remove(id); if (r.ok) changed = true; }
      if (changed) announce();
    }).catch(() => undefined);
    return () => { stopped = true; };
  }, [kind, slug, refId, renderedAt]);
  return <DraftDoneView kind={kind} refId={refId} />;
}
