'use client';
// apps/web-admin/src/components/MoneyTicker.tsx · the live money feed (PC-56 ADMIN-1e, canon W112).
//
// The ONLY client component in this console, and it is one because a live stream needs a long-lived connection that a
// server component cannot hold. It connects to the SAME-ORIGIN SSE proxy (never to admin-api directly — the god-mode
// bearer stays server-side; see the proxy route).
//
// WHAT THIS COMPONENT IS CAREFUL ABOUT — all three are the difference between a live screen and a screen that LOOKS
// live:
//   1. IT SAYS WHEN IT IS STALE. The server heartbeats every poll interval, so any longer gap means the stream is not
//      healthy — regardless of what the browser thinks about its own EventSource. A silently-frozen ticker is worse
//      than one that admits it is offline, because an operator keeps reading it.
//   2. IT RESUMES FROM A CURSOR. Reconnecting sends the last event actually RENDERED, so nothing is missed across a
//      dropped connection and nothing already seen is replayed.
//   3. ITS RUNNING TOTAL IS LABELLED "this session". It is not the day's takings — the hourly chart beside it is —
//      and presenting a session sum as a daily figure would be a number nobody can reconcile.
//
// No money arithmetic happens here beyond summing minor-unit strings as BigInt (Law 2): amounts are formatted by the
// shared formatter, never by string surgery.
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMoneyMinor } from '@krishalaya/i18n';
import {
  streamState, mergeFeed, feedCursor, sessionTotals, STALE_AFTER_HEARTBEATS,
  type MoneyEvent, type StreamState,
} from '../features/billing/live';

interface Labels {
  live: string; connecting: string; stale: string; closed: string;
  sessionTotal: string; empty: string; payment: string; invoiceIssued: string; reconnect: string; staleHint: string;
}

export function MoneyTicker({ labels }: { labels: Labels }) {
  const [feed, setFeed] = useState<MoneyEvent[]>([]);
  const [state, setState] = useState<StreamState>('connecting');
  const [pollMs, setPollMs] = useState(2000);
  const lastFrameAt = useRef<number | null>(null);
  const feedRef = useRef<MoneyEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const [generation, setGeneration] = useState(0);   // bumping this reconnects

  feedRef.current = feed;

  const connect = useCallback(() => {
    // Resume from the newest event we actually rendered — not from the beginning, which would replay the screen.
    const cursor = feedCursor(feedRef.current);
    const qs = cursor ? `?after=${encodeURIComponent(cursor.at)}&afterId=${encodeURIComponent(cursor.id)}` : '';
    const es = new EventSource(`/billing/live/stream${qs}`);
    esRef.current = es;

    es.onmessage = (ev) => {
      lastFrameAt.current = Date.now();
      try {
        const frame = JSON.parse(ev.data) as { type?: string; pollMs?: number; events?: MoneyEvent[] };
        // the server states its own interval, so the staleness threshold is never a guess on this side
        if (frame.type === 'hello' && typeof frame.pollMs === 'number') setPollMs(frame.pollMs);
        if (frame.type === 'events' && Array.isArray(frame.events)) {
          setFeed((prev) => mergeFeed(prev, frame.events ?? []));
        }
      } catch { /* a malformed frame is dropped, not rendered — but it still counts as a heartbeat */ }
    };

    // An EventSource error is usually a dropped connection; the browser retries by itself, but the SERVER also caps a
    // connection at an hour, and after that cap the retry must carry the cursor — which only a fresh EventSource does.
    es.onerror = () => { es.close(); esRef.current = null; setState('closed'); };

    return () => { es.close(); esRef.current = null; };
  }, []);

  useEffect(() => connect(), [connect, generation]);

  // Re-evaluate the state on a timer as well as on frames: going stale is the ABSENCE of an event, so it can only be
  // noticed by a clock.
  useEffect(() => {
    const t = setInterval(() => {
      setState(streamState({
        open: !!esRef.current, closed: !esRef.current, lastFrameAt: lastFrameAt.current, now: Date.now(), pollMs,
      }));
    }, Math.max(500, Math.floor(pollMs / 2)));
    return () => clearInterval(t);
  }, [pollMs]);

  const totals = sessionTotals(feed);
  const stateClass = state === 'live' ? 'kv-status--ok' : state === 'stale' ? 'kv-status--danger' : 'kv-status--warn';

  return (
    <section aria-labelledby="ticker-h">
      <h2 id="ticker-h">
        <span className={`kv-status ${stateClass}`} role="status" aria-live="polite">{labels[state]}</span>
      </h2>

      {/* The stale/closed case is the important one, so it gets a sentence and a way out rather than a coloured dot. */}
      {(state === 'stale' || state === 'closed') && (
        <p className="kv-error" role="alert">
          {labels.staleHint}{' '}
          <button type="button" className="kv-btn kv-btn--sm" onClick={() => { lastFrameAt.current = null; setGeneration((g) => g + 1); }}>
            {labels.reconnect}
          </button>
        </p>
      )}

      {totals.length > 0 && (
        <p className="kv-detail__muted">
          {/* explicitly "this session" — not the day's takings */}
          {labels.sessionTotal}: {totals.map((x) => `${formatMoneyMinor(x.receivedMinor, x.currency)} (${x.count})`).join(' · ')}
        </p>
      )}

      {feed.length === 0 ? <p className="kv-empty">{labels.empty}</p> : (
        <ul className="kv-list" role="list">
          {feed.map((e) => (
            <li key={String(e.id)} className="kv-card">
              <p className="kv-card__title">
                <span className={`kv-status ${e.kind === 'payment' ? 'kv-status--ok' : 'kv-status--muted'}`}>
                  {e.kind === 'payment' ? labels.payment : labels.invoiceIssued}
                </span>
                {' '}{formatMoneyMinor(String(e.amountMinor ?? '0'), String(e.currency ?? 'INR'))}
              </p>
              <p className="kv-detail__muted">
                {e.tenantSlug ?? '—'}{e.invoiceNo ? ` · ${e.invoiceNo}` : ''}{e.at ? ` · ${new Date(e.at).toLocaleTimeString()}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="kv-field__hint">
        {/* the real latency bound, from the server's own hello frame — never a hard-coded claim */}
        {`${pollMs / 1000}s · ${STALE_AFTER_HEARTBEATS}× missed heartbeats = stale`}
      </p>
    </section>
  );
}
