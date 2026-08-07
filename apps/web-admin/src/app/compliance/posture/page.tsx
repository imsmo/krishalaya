// apps/web-admin/src/app/compliance/posture/page.tsx · W048, the compliance overview (PC-56 ADMIN-5c).
//
// W048 describes itself as "the page a regulator or enterprise buyer would ask to see", and that is the whole design
// constraint. Every number here will be read by somebody with an incentive to check it, so:
//   • a tile whose source could not be read SAYS SO rather than showing a number;
//   • "all quiet" is only claimable when EVERY register was actually readable — an empty attention list assembled from
//     sources that failed to load says "nothing needs attention" when the truth is "we could not look";
//   • the RETENTION tile is never the canon's "61/61 ✓". The worker implements `delete` only, by its own comment, and
//     six of the thirteen seeded policies are `anonymise` or `archive`. A green fraction over policies nothing can run
//     would be the most reassuring false statement on this page;
//   • the CERTIFICATION list is served from one source that the public trust page must mirror. Two hand-maintained
//     lists drift, and the direction that matters is the public one claiming something we do not hold.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import {
  tileValue, retentionKey, retentionClass, attentionClass, allQuiet, unreadSources, certificationHeld,
  certificationClass, type Tile, type RetentionTile, type AttentionItem, type SourcesRead, type Certification,
} from '../../../features/compliance/breach-notification';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('pos.title'), robots: { index: false, follow: false } };
}

interface Posture {
  tiles: { openDsr: Tile; openBreaches: Tile; containedBreaches: Tile; retention: RetentionTile; mandatoryPurposes: Tile; purposesWithoutNotice: Tile };
  attention: AttentionItem[];
  allQuiet: boolean;
  sourcesRead: SourcesRead;
  notifyWindowHours: number;
  certifications: Certification[];
  computedLive: boolean;
}

function Stat({ label, t: tile_, t2 }: { label: string; t: Tile; t2: ReturnType<typeof getTranslator> }) {
  const v = tileValue(tile_);
  return (
    <div className="kv-card kv-stat">
      <div className="kv-stat__label">{label}</div>
      {/* A tile whose source failed reports the reason. It never shows 0 — on this page a zero is a claim. */}
      <div className="kv-stat__value">{v.known ? String(v.value) : t2.t('pos.unavailable')}</div>
      {!v.known && tile_ && tile_.kind === 'unavailable' && <div className="kv-detail__muted">{tile_.reason}</div>}
    </div>
  );
}

export default async function CompliancePosturePage() {
  requireAdmin();
  const t = getTranslator();

  let p: Posture | undefined; let notice: string | undefined;
  try { p = (await adminGet<Posture>('compliance/posture')).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  if (!p) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/compliance">{t.t('compliance.back')}</Link></p>
        <h1>{t.t('pos.title')}</h1>
        <p className="kv-error" role="alert">{notice}</p>
        {/* W048's error copy says "KPIs are computed nightly; cached values shown". There is no cache, so this page does
            not claim one — a comfortable lie about staleness is still a lie, and this is the page where it would be read
            by somebody checking. */}
        <p className="kv-detail__muted">{t.t('pos.noCache')}</p>
      </section>
    );
  }

  const quiet = allQuiet(p.attention, p.sourcesRead);
  const unread = unreadSources(p.sourcesRead);
  const rk = retentionKey(p.tiles.retention);

  return (
    <section>
      <p className="kv-backlink"><Link href="/compliance">{t.t('compliance.back')}</Link></p>
      <h1>{t.t('pos.title')}</h1>
      <p className="kv-muted">{t.t('pos.lead')}</p>

      <div className="kv-stat-row">
        <Stat label={t.t('pos.openDsr')} t={p.tiles.openDsr} t2={t} />
        <Stat label={t.t('pos.openBreaches')} t={p.tiles.openBreaches} t2={t} />
        <Stat label={t.t('pos.containedBreaches')} t={p.tiles.containedBreaches} t2={t} />
        <div className="kv-card kv-stat">
          <div className="kv-stat__label">{t.t('pos.retention')}</div>
          <div className="kv-stat__value">
            <span className={retentionClass(p.tiles.retention)}>
              {p.tiles.retention.kind === 'coverage' ? `${p.tiles.retention.runnable}/${p.tiles.retention.total}` : t.t('pos.unavailable')}
            </span>
          </div>
          {/* Not a tick. The gap is named, with the actions that have no pipeline. */}
          <div className="kv-detail__muted">
            {p.tiles.retention.kind === 'coverage' && rk === 'partial'
              ? t.t('pos.retentionGap', { n: String(p.tiles.retention.unrunnable), actions: p.tiles.retention.unrunnableActions.join(', ') })
              : t.t(`pos.retention.${rk}`)}
          </div>
        </div>
        <Stat label={t.t('pos.purposesWithoutNotice')} t={p.tiles.purposesWithoutNotice} t2={t} />
      </div>

      <h2>{t.t('pos.attentionHeading')}</h2>
      {/* THE CLAIM THIS PAGE IS MOST LIKELY TO GET WRONG. An empty list is only "all quiet" when everything was read. */}
      {quiet && <p className="kv-success" role="status">{t.t('pos.allQuiet')}</p>}
      {!quiet && p.attention.length === 0 && (
        <p className="kv-notice">{t.t('pos.quietButUnread', { sources: unread.map((s) => t.t(`pos.source.${s}`)).join(', ') })}</p>
      )}
      {p.attention.length > 0 && (
        <ul className="kv-list">
          {p.attention.map((a) => (
            <li key={a.id}>
              <span className={attentionClass(a.severity)}>{t.t(`pos.sev.${a.severity}`)}</span>{' '}
              {t.t(`pos.msg.${a.messageKey}`, a.params ?? {})}
              {a.href && <> — <Link href={a.href}>{t.t('pos.open')}</Link></>}
            </li>
          ))}
        </ul>
      )}

      <h2>{t.t('pos.certHeading')}</h2>
      {/* W048: "No certification is claimed before it is held — the public trust page mirrors this list verbatim." */}
      <p className="kv-notice">{t.t('pos.certRule')}</p>
      <ul className="kv-list">
        {p.certifications.map((c) => (
          <li key={c.code}>
            <strong>{c.name}</strong>{' '}
            <span className={certificationClass(c)}>{t.t(certificationHeld(c) ? 'pos.cert.held' : `pos.cert.${c.state}`)}</span>
            <br /><span className="kv-detail__muted">{c.note}</span>
          </li>
        ))}
      </ul>

      {p.computedLive && <p className="kv-detail__muted">{t.t('pos.computedLive')}</p>}
      <p className="kv-detail__muted">{t.t('pos.windowNote', { h: String(p.notifyWindowHours) })}</p>
    </section>
  );
}
