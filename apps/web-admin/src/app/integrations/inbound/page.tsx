// apps/web-admin/src/app/integrations/inbound/page.tsx · W106's inbound log (PC-56 ADMIN-11c).
//
// **THIS LOG HAD NO SOURCE UNTIL THIS RELEASE.** W106 states it as a property of the platform — "raw payloads stored
// pre-processing (inbound_webhooks, partitioned) — replayable, audit-grade; failed signatures are ignored, never
// processed" — and `inbound_webhooks`, created in migration 0015, had no reader and no writer anywhere in the monorepo.
// The four public sinks verified their HMACs correctly and then discarded the bytes, so a REJECTED signature left no
// trace at all: the one event that most needs a record was the one this platform could not see afterwards.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import {
  outcomeKey, payloadNoteKey, verdictClass, verdictKey, type InboundRow,
} from '../../../features/integrations/api-oversight';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ap11.inboundLog'), robots: { index: false, follow: false } };
}

interface Meta {
  total24h: number; undecided: number;
  byReason: { reason: string; provider: string; n: number }[];
  beganWithRelease: string;
}

export default async function InboundPage({ searchParams }: { searchParams: { failuresOnly?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const failuresOnly = searchParams.failuresOnly === '1';

  let rows: InboundRow[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<InboundRow[]>(`platform-api/webhooks/inbound${failuresOnly ? '?failuresOnly=true' : ''}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'ap11.restricted' : 'ap11.error.inbound';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/integrations">{t.t('ap11.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('ap11.inboundLog')}</span>
      </nav>
      <header className="kv-page__head">
        <h1>{t.t('ap11.inboundLog')}</h1>
        <p className="kv-page__sub">{t.t('ap11.inbound.sub')}</p>
      </header>
      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}

      {meta ? (
        <>
          <section className="kv-stats" aria-label={t.t('ap11.census')}>
            <div className="kv-stat"><dt>{t.t('ap11.stat.sigFailures')}</dt><dd>{meta.total24h}</dd></div>
            {/* A receipt written and never settled: the process died mid-handling. A finding, not a neutral state. */}
            <div className="kv-stat"><dt>{t.t('ap11.stat.undecided')}</dt><dd>{meta.undecided}</dd></div>
          </section>

          {/* THE DIAGNOSIS W106 PRINTS ("all from one stale Gupshup secret") — reachable only because the REASON is
              recorded, not just the verdict. */}
          {meta.byReason.length > 0 ? (
            <ul className="kv-list">
              {meta.byReason.map((b) => (
                <li key={`${b.provider}-${b.reason}`}>
                  {t.t('ap11.inbound.breakdown', { provider: b.provider, reason: t.t(`ap11.sig.${b.reason}`), n: String(b.n) })}
                </li>
              ))}
            </ul>
          ) : null}

          {/* An audit log that starts today reads exactly like a clean one. */}
          <p className="kv-note">{t.t(meta.beganWithRelease)}</p>
        </>
      ) : null}

      <nav className="kv-filters" aria-label={t.t('ap11.filterGroup')}>
        <Link className={`kv-chip${!failuresOnly ? ' is-active' : ''}`} href="/integrations/inbound">{t.t('common.all')}</Link>
        <Link className={`kv-chip${failuresOnly ? ' is-active' : ''}`} href="/integrations/inbound?failuresOnly=1">
          {t.t('ap11.inbound.failuresOnly')}
        </Link>
      </nav>

      {rows.length === 0 && !notice ? (
        <div className="kv-empty">
          <h2>{t.t('ap11.inbound.emptyTitle')}</h2>
          <p>{t.t('ap11.inbound.emptyBody')}</p>
        </div>
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('ap11.inbound.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('ap11.col.when')}</th>
              <th scope="col">{t.t('ap11.col.provider')}</th>
              <th scope="col">{t.t('ap11.col.event')}</th>
              <th scope="col">{t.t('ap11.col.signature')}</th>
              <th scope="col">{t.t('ap11.col.outcome')}</th>
              <th scope="col">{t.t('ap11.col.payload')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const note = payloadNoteKey(r);
              return (
                <tr key={r.id}>
                  <td>{r.createdAt.slice(0, 16).replace('T', ' ')}</td>
                  <td className="kv-mono">{r.providerCode}</td>
                  <td>{r.eventType ?? '—'}</td>
                  <td><span className={verdictClass(r)}>{t.t(verdictKey(r))}</span></td>
                  {/* A refused callback is `ignored`, never `failed`: the platform declined rather than tried and could
                      not. That is a defence working, and calling it a failure would put it in the wrong report. */}
                  <td>{t.t(outcomeKey(r.processingStatus))}</td>
                  <td>
                    {r.rawBytes === null ? '—' : t.t('ap11.bytes', { n: r.rawBytes.toLocaleString('en-IN') })}
                    {note ? <><br /><small className="kv-badge is-warn">{t.t(note)}</small></> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="kv-note"><small>{t.t('ap11.inbound.piiNote')}</small></p>
    </main>
  );
}
