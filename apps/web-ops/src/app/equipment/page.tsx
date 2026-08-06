// apps/web-ops/src/app/equipment/page.tsx · CHC home (PC-33 OW-3): the rental queue (status filter, keyset
// preserving it) + the asset register with availability toggles. Row → /equipment/[id] for the lifecycle.
//
// PC-55 B5 · EAR-TAG LOOKUP. OW-3 shipped an honest note here saying the animal registry had "no tag-number search
// parameter yet (API gap)". That note went STALE the moment PC-54 W54-4 added `pashuAadhaar` to the animal list
// query — so the console was carrying a false claim about its own platform. The note is now the real lookup: type
// or scan the 12-digit INAPH tag and get the animal, or an honest "no animal with that tag in this tenant".
// The tag is normalised (spaces/dashes stripped — that is how it is printed and how a person reads it aloud at a
// gate) and refused locally if it is not 12 digits, so a mistyped tag costs no round trip.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { RENTAL_STATUSES, isRentalStatus } from '../../features/equipment/manage';
import { normaliseEarTag } from '../../features/equipment/ear-tag';
import type { Animal, EquipmentAsset, EquipmentRental } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('chc.title'), robots: { index: false, follow: false } };
}

export default async function EquipmentPage({ searchParams }: { searchParams: { status?: string; cursor?: string; tag?: string } }) {
  await requireSession('/equipment');
  const t = getTranslator();
  const lang = getLang();
  const status = isRentalStatus(searchParams.status) ? searchParams.status : undefined;

  let rentals: EquipmentRental[] = []; let nextCursor: string | null = null; let rentalsFailed = false;
  try {
    const p = await opsClient().equipment.rentals({ status, cursor: searchParams.cursor, limit: 50 });
    rentals = p.items; nextCursor = p.nextCursor;
  } catch { rentalsFailed = true; }

  let assets: EquipmentAsset[] = []; let assetsFailed = false;
  try { assets = (await opsClient().equipment.assets({ limit: 50 })).items; }
  catch { assetsFailed = true; }

  // --- PC-55 B5 ear-tag lookup (its own degrade path: a failed search must not blank the CHC queue) ---
  const rawTag = (searchParams.tag ?? '').trim();
  const tag = normaliseEarTag(rawTag);
  const tagInvalid = rawTag.length > 0 && tag === null;
  let tagged: Animal[] = []; let tagFailed = false;
  if (tag) {
    try { tagged = (await opsClient().livestock.animals({ box: 'all', pashuAadhaar: tag, limit: 20 })).items; }
    catch { tagFailed = true; }
  }

  const assetName = (id: string) => assets.find((a) => a.id === id)?.defaultName ?? id.slice(0, 8);
  const pager = (cursor: string) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('cursor', cursor);
    return `/equipment?${qs.toString()}`;
  };

  return (
    <section>
      <h1>{t.t('chc.title')}</h1>
      <p className="kv-field__hint">{t.t('chc.hint')}</p>

      <h2>{t.t('chc.rentals')}</h2>
      <form method="get" action="/equipment" className="kv-inline-form" role="search" aria-label={t.t('chc.filterLabel')}>
        <label htmlFor="ch-status" className="kv-field__label">{t.t('chc.colStatus')}</label>
        <select id="ch-status" name="status" defaultValue={status ?? ''} className="kv-input">
          <option value="">{t.t('chc.status.any')}</option>
          {RENTAL_STATUSES.map((s) => <option key={s} value={s}>{t.t(`chc.status.${s}`)}</option>)}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('chc.apply')}</button>
      </form>

      {rentalsFailed ? <p className="kv-error" role="alert">{t.t('chc.loadError')}</p> : (
        <DataTable
          rows={rentals}
          empty={t.t('chc.rentalsEmpty')}
          columns={[
            { header: t.t('chc.colRental'), cell: (r) => <Link href={`/equipment/${r.id}`} className="kv-link">{(r.assetName ?? assetName(r.assetId))} · {r.quantity} {r.unitCode}</Link> },
            { header: t.t('chc.colStatus'), cell: (r) => <span className="kv-badge">{t.t(`chc.status.${r.status}`) || r.status}</span> },
            { header: t.t('chc.colAdvance'), cell: (r) => (r.advanceMinor ? formatMoneyMinor(r.advanceMinor, 'INR', lang) : t.t('common.dash')) },
            { header: t.t('chc.colScheduled'), cell: (r) => (r.scheduledAt ? formatDate(r.scheduledAt, lang) : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={pager(nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}

      <h2>{t.t('chc.assets')}</h2>
      {assetsFailed ? <p className="kv-error" role="alert">{t.t('chc.loadError')}</p> : (
        <DataTable
          rows={assets}
          empty={t.t('chc.assetsEmpty')}
          columns={[
            { header: t.t('chc.colAsset'), cell: (a) => a.defaultName },
            { header: t.t('chc.colStatus'), cell: (a) => <span className="kv-badge">{a.status ?? t.t('common.dash')}</span> },
          ]}
        />
      )}
      <h2>{t.t('tag.title')}</h2>
      <form method="get" action="/equipment" className="kv-search" role="search" aria-label={t.t('tag.title')}>
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <label htmlFor="tag" className="kv-field__label">{t.t('tag.label')}</label>
        <input id="tag" name="tag" className="kv-input" inputMode="numeric" defaultValue={rawTag} maxLength={20} aria-describedby="tag-hint" />
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('tag.search')}</button>
      </form>
      <p id="tag-hint" className="kv-field__hint">{t.t('tag.hint')}</p>
      {tagInvalid ? <p className="kv-error" role="alert">{t.t('tag.invalid')}</p> : null}
      {tagFailed ? <p className="kv-error" role="alert">{t.t('chc.loadError')}</p> : null}
      {tag && !tagFailed ? (
        <DataTable
          rows={tagged}
          empty={t.t('tag.empty')}
          columns={[
            { header: t.t('tag.colTag'), cell: (a) => a.pashuAadhaar ?? t.t('common.dash') },
            { header: t.t('tag.colAnimal'), cell: (a) => a.name || t.t('tag.unnamed') },
            { header: t.t('tag.colStatus'), cell: (a) => <span className="kv-badge">{a.status ?? t.t('common.dash')}</span> },
            { header: t.t('tag.colOwner'), cell: (a) => (a.ownerUserId ? `${a.ownerUserId.slice(0, 8)}…` : t.t('common.dash')) },
          ]}
        />
      ) : null}
      <p className="kv-field__hint kv-note">{t.t('tag.note')}</p>
    </section>
  );
}
