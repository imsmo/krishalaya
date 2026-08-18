// apps/web-admin/src/app/compliance/consent/page.tsx · W046, the consent registry (PC-56 ADMIN-5b).
//
// THE ADMIN CONSOLE HAS NEVER SEEN THIS TABLE. `consents` has existed since migration 0001, is correctly append-only,
// and holds the whole record of who agreed to what — and there was no admin endpoint, no page, and no permission.
// This is the first read, behind `compliance.consent.read`, which W046's own restricted state names.
//
// Three things this page refuses to say:
//   • It does not call a REFUSAL a withdrawal. The schema stores `granted boolean` append-only, so a withdrawal is a
//     granted:false event superseding a prior grant; a granted:false with no prior grant is somebody who said no the
//     first time. Merging them would inflate every withdrawal figure with people who never consented.
//   • It does not imply we can produce the words. Before migration 0108 the version was a label pointing at a mutable
//     column, so for most rows the notice text was overwritten and is gone. Those rows are flagged.
//   • It does not show a full name or number. The mask is server-side (core/pii), so the raw values never reach this
//     process at all.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { Button, Callout, Chip, StatusPill } from '@krishalaya/ui';
import {
  CONSENT_CHANNELS, channelFilter, decisionKey, decisionTone, provenanceKey, provenanceTone,
  assistedShareText, type ConsentEventRow,
} from '../../../features/compliance/consent';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cns.registryTitle'), robots: { index: false, follow: false } };
}

interface Tiles { principals: number; totalEvents: number; assistedEvents: number; assistedEventPct: number | null; basis: string }

export default async function ConsentRegistryPage({ searchParams }: { searchParams: { purposeCode?: string; channel?: string; withdrawn?: string; cursor?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const channel = channelFilter(searchParams.channel);
  const purposeCode = searchParams.purposeCode?.trim() || undefined;
  const withdrawnOnly = searchParams.withdrawn === 'true' ? 'true' : undefined;

  let rows: ConsentEventRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  let ivrGap: { available: boolean } | undefined;
  try {
    const res = await adminGet<ConsentEventRow[]>('consent/registry', {
      purposeCode, channel, withdrawnOnly, cursor: searchParams.cursor, limit: 50,
    });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
    ivrGap = res.meta?.ivrEvidence as { available: boolean } | undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  // Tiles degrade on their own (Law 12) — the register is the record, the tiles are context.
  let tiles: Tiles | null = null;
  try { tiles = (await adminGet<Tiles>('consent/registry/tiles')).data ?? null; } catch { /* blank */ }

  const qp = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ purposeCode, channel, withdrawn: withdrawnOnly, ...extra })) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/compliance/consent${s ? `?${s}` : ''}`;
  };

  const cols: Column<ConsentEventRow>[] = [
    { header: t.t('cns.when'), cell: (r) => r.at ?? t.t('common.dash') },
    { header: t.t('cns.principal'), cell: (r) => <span className="kv-masked" title={t.t('cns.maskedTitle')}>{r.principal.nameMasked ?? t.t('cns.noName')} · {r.principal.phoneMasked ?? t.t('cns.noPhone')}</span> },
    { header: t.t('cns.purpose'), cell: (r) => <Link href={`/compliance/consent/purposes/${encodeURIComponent(r.purposeCode)}`}>{r.purposeCode}</Link> },
    {
      header: t.t('cns.version'),
      cell: (r) => (
        <>
          {r.version ?? t.t('common.dash')}{' '}
          {/* Can we produce the words this person agreed to? For most rows the answer is no, and saying so is the point. */}
          <StatusPill tone={provenanceTone(r.provenance)} label={t.t(`cns.prov.${provenanceKey(r.provenance)}`)} />
        </>
      ),
    },
    { header: t.t('cns.decision'), cell: (r) => <StatusPill tone={decisionTone(r.decision)} label={t.t(`cns.dec.${decisionKey(r.decision)}`)} /> },
    { header: t.t('cns.channel'), cell: (r) => t.t(`cns.ch.${CONSENT_CHANNELS.includes(r.channel as never) ? r.channel : 'unknown'}`) },
    // An ambassador is staff acting in role, not a data subject on this screen — the id is what an operator needs to find
    // their record, and masking it would remove the accountability the assisted channel exists to provide.
    { header: t.t('cns.assistedBy'), cell: (r) => r.assistedBy ?? t.t('common.dash') },
  ];

  const assisted = assistedShareText(tiles?.assistedEventPct);

  return (
    <section>
      <p className="kv-backlink"><Link href="/compliance">{t.t('compliance.back')}</Link></p>
      <h1>{t.t('cns.registryTitle')}</h1>
      <p className="kv-muted">{t.t('cns.registryLead')}</p>
      <Callout tone="warning">{t.t('cns.maskNotice')}</Callout>
      {/* The rule that decides how this table is read, stated before it. */}
      <Callout tone="warning">{t.t('cns.withdrawnRule')}</Callout>

      {tiles && (
        <div className="kv-stat-row">
          <div className="kv-card kv-stat">
            <div className="kv-stat__label">{t.t('cns.tilePrincipals')}</div>
            <div className="kv-stat__value">{String(tiles.principals)}</div>
          </div>
          <div className="kv-card kv-stat">
            <div className="kv-stat__label">{t.t('cns.tileEvents')}</div>
            <div className="kv-stat__value">{String(tiles.totalEvents)}</div>
          </div>
          <div className="kv-card kv-stat">
            <div className="kv-stat__label">{t.t('cns.tileAssisted')}</div>
            {/* NULL renders as a dash, never 0% — no events at all is not "nobody was assisted". */}
            <div className="kv-stat__value">{assisted.known ? `${assisted.pct}%` : t.t('common.dash')}</div>
            <div className="kv-detail__muted">{t.t('cns.tileAssistedBasis')}</div>
          </div>
        </div>
      )}
      {!tiles && <p className="kv-detail__muted">{t.t('cns.tilesUnavailable')}</p>}

      <nav className="kv-filters" aria-label={t.t('cns.channelFilter')}>
        <Chip as={Link} href={qp({ channel: undefined, cursor: undefined })} aria-current={!channel ? 'true' : undefined} active={!channel}>{t.t('cns.allChannels')}</Chip>
        {CONSENT_CHANNELS.map((c) => (
          <Chip as={Link} key={c} href={qp({ channel: c, cursor: undefined })} aria-current={channel === c ? 'true' : undefined} active={channel === c}>{t.t(`cns.ch.${c}`)}</Chip>
        ))}
      </nav>
      <nav className="kv-filters" aria-label={t.t('cns.decisionFilter')}>
        <Chip as={Link} href={qp({ withdrawn: undefined, cursor: undefined })} active={!withdrawnOnly}>{t.t('cns.allDecisions')}</Chip>
        <Chip as={Link} href={qp({ withdrawn: 'true', cursor: undefined })} active={!!withdrawnOnly}>{t.t('cns.notGrantedOnly')}</Chip>
      </nav>
      {/* The filter is `granted = false`, which is refusals AND withdrawals — named accurately rather than as
          "withdrawn only", because the SQL cannot tell them apart without the prior-grant lookup each row carries. */}
      <p className="kv-detail__muted">{t.t('cns.notGrantedHint')}</p>

      <p className="kv-backlink"><Link href="/compliance/consent/purposes">{t.t('cns.purposesLink')}</Link></p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('cns.registryEmpty')} />
          {nextCursor && <p className="kv-pager"><Button as={Link} href={qp({ cursor: nextCursor })}>{t.t('common.nextPage')}</Button></p>}
        </>
      )}

      {/* An IVR consent's evidence is the recording, and there is nowhere to store its reference. */}
      {ivrGap && !ivrGap.available && <Callout tone="warning">{t.t('cns.ivrGap')}</Callout>}
    </section>
  );
}
