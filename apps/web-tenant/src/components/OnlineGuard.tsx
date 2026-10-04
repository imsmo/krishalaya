'use client';
// apps/web-tenant/src/components/OnlineGuard.tsx · PC-56 TENANT-SW-f · W318 §2 — READ-ONLY DEGRADED MODE for the whole console.
//
// Mounted once in the console shell. `navigator.onLine` + a heartbeat to the console's own `/api/ping` every 30 s (5 s timeout). When either
// fails the console goes READ-ONLY: a banner says so in words, and every write button (each submit of a POST form — a server action) is
// disabled and reads "— needs signal" (`applySignal`). Links and GET forms stay usable. When the signal returns, the buttons come back as
// they were — and NOTHING is replayed: there is no queue (NO_OFFLINE_WRITE_QUEUE), so the operator presses again on a live page, whose
// confirm step re-reads the row (verify-before-write, features/mutate/verify).
import { useEffect, useState } from 'react';
import { applySignal, signalMode, HEARTBEAT_MS, HEARTBEAT_TIMEOUT_MS, PING_PATH, type SignalMode } from '../features/offline/signal';

export interface SignalLabels { banner: string; detail: string; needsSignal: string; policy: string; policyHref: string }

/** PURE view — the render test renders it in both modes. */
export function SignalBanner({ mode, labels }: { mode: SignalMode; labels: SignalLabels }) {
  if (mode === 'live') return null;
  return (
    <div className="kv-error kv-signal" role="alert" data-kv-signal="degraded">
      <strong>{labels.banner}</strong> <span>{labels.detail}</span> <span className="kv-signal__word">{labels.needsSignal}</span>
      {' · '}<a href={labels.policyHref} className="kv-btn--link">{labels.policy}</a>
    </div>
  );
}

export function OnlineGuard({ labels }: { labels: SignalLabels }) {
  const [online, setOnline] = useState(true);
  const [beat, setBeat] = useState<boolean | null>(null);
  const mode = signalMode(online, beat);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    let stopped = false;
    const ping = async () => {
      const ctl = new AbortController(); const timer = window.setTimeout(() => ctl.abort(), HEARTBEAT_TIMEOUT_MS);
      try { const r = await fetch(PING_PATH, { cache: 'no-store', signal: ctl.signal }); if (!stopped) setBeat(r.ok); }
      catch { if (!stopped) setBeat(false); }
      finally { window.clearTimeout(timer); }
    };
    void ping();
    const id = window.setInterval(() => void ping(), HEARTBEAT_MS);
    return () => { stopped = true; window.removeEventListener('online', on); window.removeEventListener('offline', off); window.clearInterval(id); };
  }, []);
  useEffect(() => {
    applySignal(document as never, mode, labels.needsSignal);
    if (mode === 'live') return;
    // pages reached by client navigation bring new forms: hold their write buttons too, for as long as the signal is down
    const obs = new MutationObserver(() => applySignal(document as never, 'degraded', labels.needsSignal));
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [mode, labels.needsSignal]);
  return <SignalBanner mode={mode} labels={labels} />;
}
