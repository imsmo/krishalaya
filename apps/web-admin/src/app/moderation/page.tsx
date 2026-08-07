// apps/web-admin/src/app/moderation/page.tsx · W089, the trust & safety overview (PC-56 ADMIN-5d).
//
// W089's three principles are printed on the page because they are the argument for how it behaves, not decoration:
// hold fast and remove slow, every action explains itself, and bands move gradually rather than cliff-edging to
// blocked without a human signature.
//
// TWO TILES DO NOT CARRY A NUMBER AND THAT IS THE POINT.
//   • "Listings held" is unavailable because THERE IS NO LISTING HOLD ON THE PLATFORM — `listing_status` has no
//     `held` value, and handling a report as `hidden` does not touch the listing. A 0 here would say the marketplace
//     is flowing clean.
//   • Anything from a register that failed to load is unavailable rather than zero, and "all queues clear" is
//     refused unless all four registers were actually read. An empty attention list assembled from sources that did
//     not load tells a safety desk to go home.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import {
  tileText, slaClass, attentionClass, allQuiet, unreadSources,
  type Tile, type SlaState, type AttentionItem, type SourcesRead,
} from '../../features/trust/trust-safety';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ts.title'), robots: { index: false, follow: false } };
}

interface Overview {
  tiles: { openReports: Tile; listingsHeld: Tile; appealsPending: Tile; blocksActive: Tile };
  sla: { reports: SlaState; appeals: SlaState };
  attention: AttentionItem[];
  allQuiet: boolean;
  unreadSources: string[];
  sources: SourcesRead;
}

function Stat({ label, tile }: { label: string; tile: Tile }) {
  const unavailable = !tile || tile.kind !== 'value';
  return (
    <div className="kv-card kv-stat">
      <div className="kv-stat__label">{label}</div>
      <div className="kv-stat__value">{tileText(tile)}</div>
      {unavailable && tile && tile.kind === 'unavailable' && <div className="kv-detail__muted">{tile.reason}</div>}
    </div>
  );
}

export default async function ModerationOverviewPage() {
  requireAdmin();
  const t = getTranslator();

  let o: Overview | undefined; let notice: string | undefined;
  try { o = (await adminGet<Overview>('trust/overview')).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  if (!o) {
    return (
      <section>
        <h1>{t.t('ts.heading')}</h1>
        {/* W089's error state says holds enforce server-side regardless. On this platform they do not enforce at all,
            so the honest version of that reassurance is the one below. */}
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  const quiet = allQuiet(o.attention, o.sources);
  const unread = unreadSources(o.sources);

  return (
    <section>
      <h1>{t.t('ts.heading')}</h1>
      <p className="kv-muted">{t.t('ts.lead')}</p>

      <div className="kv-stat-row">
        <Stat label={t.t('ts.tile.openReports')} tile={o.tiles.openReports} />
        <Stat label={t.t('ts.tile.listingsHeld')} tile={o.tiles.listingsHeld} />
        <Stat label={t.t('ts.tile.appealsPending')} tile={o.tiles.appealsPending} />
        <Stat label={t.t('ts.tile.blocksActive')} tile={o.tiles.blocksActive} />
      </div>

      <dl className="kv-facts">
        <div className="kv-facts__row">
          <dt>{t.t('ts.reportSla')}</dt>
          <dd><span className={slaClass(o.sla.reports)}>{t.t(`ts.sla.${o.sla.reports?.kind ?? 'unmeasured'}`)}</span></dd>
        </div>
        <div className="kv-facts__row">
          <dt>{t.t('ts.appealSla')}</dt>
          <dd><span className={slaClass(o.sla.appeals)}>{t.t(`ts.sla.${o.sla.appeals?.kind ?? 'unmeasured'}`)}</span></dd>
        </div>
      </dl>

      <h2>{t.t('ts.attentionHeading')}</h2>
      {quiet ? (
        <p className="kv-success" role="status">{t.t('ts.allQuiet')}</p>
      ) : (
        <>
          {o.attention.length === 0 && (
            // NOT "all clear". The list is empty AND something failed to load, which are different facts.
            <p className="kv-error" role="alert">
              {t.t('ts.cannotClaimQuiet', { sources: unread.map((s) => t.t(`ts.source.${s}`)).join(', ') })}
            </p>
          )}
          <ul className="kv-list">
            {o.attention.map((a) => (
              <li key={a.id} >
                <span className={attentionClass(a.severity)}>{t.t(`ts.sev.${a.severity}`)}</span>{' '}
                {t.t(a.messageKey, a.params ?? {})}
              </li>
            ))}
          </ul>
          {unread.length > 0 && o.attention.length > 0 && (
            <p className="kv-detail__muted">{t.t('ts.unread', { sources: unread.map((s) => t.t(`ts.source.${s}`)).join(', ') })}</p>
          )}
        </>
      )}

      <h2>{t.t('ts.principlesHeading')}</h2>
      <ul className="kv-list">
        <li >{t.t('ts.principle.holdFast')}</li>
        <li >{t.t('ts.principle.explains')}</li>
        <li >{t.t('ts.principle.gradual')}</li>
      </ul>
      {/* The one thing W089 does not say and this platform must: the ladder in the third principle is not applied. */}
      <p className="kv-error" role="note">{t.t('ts.advisoryBanner')}</p>

      <h2>{t.t('ts.sectionsHeading')}</h2>
      <ul className="kv-list">
        <li ><Link href="/moderation/risk">{t.t('ts.nav.risk')}</Link></li>
        <li ><Link href="/moderation/risk/rules">{t.t('ts.nav.rules')}</Link></li>
        <li ><Link href="/moderation/blocklists">{t.t('ts.nav.blocklists')}</Link></li>
        <li ><Link href="/moderation/insights">{t.t('ts.nav.insights')}</Link></li>
      </ul>
      {/* Listings, reports and appeals are named as NOT BUILT rather than linked to a 404 or silently omitted — the
          nav model's own rule (a link only when the route exists), applied to sections a reader will look for. */}
      <p className="kv-detail__muted">{t.t('ts.notBuilt')}</p>
    </section>
  );
}
