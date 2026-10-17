'use client';
// apps/web-storefront/src/components/drafts/DraftKeeper.tsx · PC-56 STORE-6b · D4 / C2 — YOUR WORDS, KEPT ON THIS PHONE AS YOU TYPE. Mounted INSIDE
// the thread composer (`messages/[id]`, kind `message`, ref = the conversation) and the review form + the review edit form (kind `review`,
// ref = the order). It finds its own <form>, and:
//   • on mount: the sweep (another owner's drafts go unseen, expired ones go); if this render is the act's SUCCESS (a `DraftDone` marker for the
//     same kind + ref is on the page) it fills nothing; else a draft kept for this ref (or the one `?draft=<id>` names) fills the form, and the
//     page says "Restored from this phone · <age>" — and, from 7 days, "still want to send this?";
//   • on every input: the form's named visible fields (never a hidden one) are written ~300 ms after the last keystroke (features/store6b/keeper.ts);
//   • NOTHING is sent: the person presses Send on this page, under the key this page minted at its render (keyed-at-render kept).
// No owner marker on this device (a session from before HOTFIX-8) or no IndexedDB → nothing is kept and nothing is shown (fail closed).
// Without JavaScript nothing happens at all; the form works exactly as before.
import { useEffect, useRef, useState } from 'react';
import { createKeeper, type FormLike, type KeeperStart } from '../../features/store6b/keeper';
import { ageText, type AgeLabels, type DraftKind } from '../../features/store6b/drafts';
import { announce, phoneHost, phoneNewId, phoneOwner, phoneStore } from './phone';

export interface KeeperLabels extends AgeLabels { kept: string; restored: string; ask: string; missing: string; link: string; syncHref: string }

/** PURE view — the render tests render it directly with each state. */
export function DraftKeeperView({ kind, refId, state, note, labels }: { kind: DraftKind; refId: string; state: KeeperStart['state'] | 'idle'; note: { restored?: string; ask?: boolean; missing?: boolean } | null; labels: KeeperLabels }) {
  const active = state === 'empty' || state === 'restored';
  return (
    <>
      <p hidden data-kv-draft-state={state} data-kv-draft-kind={kind} data-kv-draft-ref={refId}>{state}</p>
      {active && (
        <p className="kv-field__hint" data-kv-draft-note={state} role="status">
          {note?.restored && <><span data-kv-draft-restored="">{labels.restored.replace('{age}', note.restored)}</span>{' '}</>}
          {note?.missing && <><span data-kv-draft-missing="">{labels.missing}</span>{' '}</>}
          <span data-kv-draft-kept="">{labels.kept}</span>{' '}
          <a href={labels.syncHref} className="kv-btn--link" data-kv-link="sync">{labels.link}</a>
        </p>
      )}
      {active && note?.ask && <p className="kv-field__hint" data-kv-draft-ask="" role="status">{labels.ask}</p>}
    </>
  );
}

export function DraftKeeper({ kind, slug, refId, edit = false, labels }: { kind: DraftKind; slug: string; refId: string; edit?: boolean; labels: KeeperLabels }) {
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [state, setState] = useState<KeeperStart['state'] | 'idle'>('idle');
  const [note, setNote] = useState<{ restored?: string; ask?: boolean; missing?: boolean } | null>(null);
  useEffect(() => {
    const form = anchor.current?.closest('form') as HTMLFormElement | null;
    if (!form) { setState('off'); return; }
    const keeper = createKeeper(form as unknown as FormLike, {
      store: phoneStore(), host: phoneHost(), slug, owner: phoneOwner(), kind, ref: refId, edit,
      now: () => Date.now(), newId: phoneNewId,
      setTimer: (fn, ms) => window.setTimeout(fn, ms), clearTimer: (t) => window.clearTimeout(t as number), onWrite: announce,
    });
    let stopped = false;
    const wanted = new URLSearchParams(window.location.search).get('draft');
    const done = !!document.querySelector(`[data-kv-draft-done][data-kv-draft-kind="${kind}"][data-kv-draft-ref="${refId}"]`);
    const onInput = () => keeper.onInput();
    const flush = () => { void keeper.save(); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    keeper.start({ wanted, done }).then((s) => {
      if (stopped) return;
      setState(s.state);
      if (s.state === 'restored') setNote({ restored: ageText(s.draft.savedAt, Date.now(), labels), ask: s.ask });
      else if (s.state === 'empty' && s.wantedMissing) setNote({ missing: true });
      if (s.state === 'off' || s.state === 'done') return;
      form.addEventListener('input', onInput); form.addEventListener('change', onInput);
      document.addEventListener('visibilitychange', onHide); window.addEventListener('pagehide', flush);
    }).catch(() => { if (!stopped) setState('off'); });
    return () => {
      stopped = true;
      form.removeEventListener('input', onInput); form.removeEventListener('change', onInput);
      document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', flush);
    };
  }, [kind, slug, refId, edit]);   // eslint-disable-line react-hooks/exhaustive-deps -- the labels are the server's words, fixed for the page
  return (
    <>
      <span ref={anchor} hidden data-kv-draft-keeper={kind} />
      <DraftKeeperView kind={kind} refId={refId} state={state} note={note} labels={labels} />
    </>
  );
}
