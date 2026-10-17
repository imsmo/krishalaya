'use client';
// apps/web-storefront/src/components/sync/SyncList.tsx · PC-56 STORE-6b · B8 / C2 — the LIST on "On this phone", read from THIS phone (IndexedDB) by
// the page itself: the server never sees it, so the server's HTML carries only the honest no-JavaScript sentence. Rows: the store, the kind,
// the first words, the age, "Send now" (a LINK to the live page with `?draft=<id>` — nothing is posted from here) and "Discard" (→ the
// W3151 confirm). The 7-day question (Keep — a client write; Discard — the confirm) and the 30-day notice. Under an organisation's chrome only
// THAT organisation's drafts; on the platform every store's on this host. The discard confirm's Proceed is the REAL device act: the draft is
// deleted from this phone → `?done=discarded` (W3152), or the write fails → `?done=failed` (W3153: the draft is kept, Retry).
import { useEffect, useState } from 'react';
import type { AccountChrome } from '../../features/store4a/account';
import { ageText, firstWords, liveHref, needsAsk, type AgeLabels, type Draft } from '../../features/store6b/drafts';
import { syncHref, type SyncState } from '../../features/store6b/paths';
import { announce, settlePhone, takeExpiredNotice } from '../drafts/phone';

export interface SyncLabels extends AgeLabels {
  noscript: string; empty: string; off: string; unavailable: string; message: string; review: string; reviewEdit: string; noWords: string;
  sendNow: string; sendNowHint: string; discard: string; askTitle: string; askBody: string; keep: string; expired: string;
  proceed: string; gone: string; listTitle: string;
}

export type SyncView =
  | { kind: 'noscript' } | { kind: 'off' } | { kind: 'unavailable' }
  | { kind: 'ready'; drafts: Draft[]; now: number; expired: number };

const kindLabel = (d: Draft, l: SyncLabels) => (d.kind === 'message' ? l.message : d.edit ? l.reviewEdit : l.review);

/** PURE view — the render tests render it with a fixture store's drafts. */
export function SyncListView({ chrome, state, view, labels, onKeep, onProceed, busy }: {
  chrome: AccountChrome; state: SyncState; view: SyncView; labels: SyncLabels; onKeep?: (id: string) => void; onProceed?: (id: string) => void; busy?: boolean;
}) {
  if (view.kind === 'noscript') return <p className="kv-state" role="status" data-kv-sync="noscript">{labels.noscript}</p>;
  if (view.kind === 'off') return <p className="kv-state" role="status" data-kv-sync="off">{labels.off}</p>;
  if (view.kind === 'unavailable') return <p className="kv-state" role="status" data-kv-sync="unavailable">{labels.unavailable}</p>;
  const mine = view.drafts.filter((d) => chrome.kind === 'platform' || d.slug === chrome.slug);
  const words = (d: Draft) => (d.fields.body.trim() ? firstWords(d.fields.body, 80) : labels.noWords);
  const age = (d: Draft) => ageText(d.savedAt, view.now, labels);
  if (state.kind === 'confirm' || state.kind === 'failed') {
    const d = mine.find((x) => x.id === state.id);
    if (!d) return <p className="kv-state" role="status" data-kv-sync="gone">{labels.gone}</p>;
    return (
      <div className="kv-sync__confirm" data-kv-sync="confirm" data-kv-draft={d.id}>
        <p><strong>{kindLabel(d, labels)}</strong> · <span data-kv-draft-store="">{d.slug}</span> · <q>{words(d)}</q> · <span>{age(d)}</span></p>
        <button type="button" className="kv-btn" data-kv-act="discard" disabled={busy} onClick={() => onProceed?.(d.id)}>{labels.proceed}</button>
      </div>
    );
  }
  const ask = mine.filter((d) => needsAsk(d, view.now));
  return (
    <div data-kv-sync="list" data-kv-drafts={mine.length}>
      {view.expired > 0 && <p className="kv-form__notice" role="status" data-kv-sync-expired={view.expired}>{labels.expired}</p>}
      {ask.length > 0 && (
        <section className="kv-state" data-kv-sync-ask={ask.length} aria-label={labels.askTitle}>
          <p><strong>{labels.askTitle}</strong></p>
          <p>{labels.askBody}</p>
          <ul>
            {ask.map((d) => (
              <li key={d.id} data-kv-ask={d.id}>
                <strong>{kindLabel(d, labels)}</strong> · <q>{words(d)}</q>{' '}
                <button type="button" className="kv-btn--link" data-kv-act="keep" onClick={() => onKeep?.(d.id)}>{labels.keep}</button>{' · '}
                <a href={syncHref(chrome, { kind: 'confirm', id: d.id })} className="kv-btn--link" data-kv-act="discard-ask">{labels.discard}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {mine.length === 0 ? (
        <p className="kv-state" role="status" data-kv-sync="empty">{labels.empty}</p>
      ) : (
        <ul className="kv-sync__rows" aria-label={labels.listTitle}>
          {mine.map((d) => {
            const href = liveHref(d, chrome);
            return (
              <li key={d.id} className="kv-sync__row" data-kv-draft={d.id} data-kv-draft-kind={d.kind}>
                <strong>{kindLabel(d, labels)}</strong> · <span data-kv-draft-store="">{d.slug}</span> · <q>{words(d)}</q> · <span data-kv-draft-age="">{age(d)}</span>
                <span className="kv-cart__actions">
                  {href && <a href={href} className="kv-btn" data-kv-act="send-now" title={labels.sendNowHint}>{labels.sendNow}</a>}{' '}
                  <a href={syncHref(chrome, { kind: 'confirm', id: d.id })} className="kv-btn--link" data-kv-act="discard">{labels.discard}</a>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function SyncList({ chrome, state, labels }: { chrome: AccountChrome; state: SyncState; labels: SyncLabels }) {
  const [view, setView] = useState<SyncView>({ kind: 'noscript' });
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let stopped = false;
    settlePhone().then((p) => {
      if (stopped) return;
      if (!p) { setView({ kind: 'off' }); return; }
      if (!p.ok && p.kept.length === 0) { setView({ kind: 'unavailable' }); return; }
      setView({ kind: 'ready', drafts: p.kept.filter((d) => d.owner === p.owner).sort((a, b) => b.savedAt - a.savedAt), now: Date.now(), expired: takeExpiredNotice(p.owner) });
    }).catch(() => { if (!stopped) setView({ kind: 'unavailable' }); });
    return () => { stopped = true; };
  }, [tick]);
  const keep = async (id: string) => {
    const p = await settlePhone().catch(() => null);
    const d = p?.kept.find((x) => x.id === id && x.owner === p.owner);
    if (!p || !d) return;
    await p.store.put({ ...d, askedAt: Date.now() });
    announce(); setTick((n) => n + 1);
  };
  const proceed = async (id: string) => {
    setBusy(true);
    const p = await settlePhone().catch(() => null);
    const d = p?.kept.find((x) => x.id === id && x.owner === p.owner);
    if (p && !d) { window.location.assign(syncHref(chrome)); return; }          // no longer on this phone: back to the list
    const r = p && d ? await p.store.remove(id) : null;
    if (r && r.ok) { announce(); window.location.assign(syncHref(chrome, { kind: 'discarded' })); return; }
    window.location.assign(syncHref(chrome, { kind: 'failed', id }));
  };
  return <SyncListView chrome={chrome} state={state} view={view} labels={labels} onKeep={(id) => { void keep(id); }} onProceed={(id) => { void proceed(id); }} busy={busy} />;
}
