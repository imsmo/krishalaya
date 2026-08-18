// apps/web-admin/src/app/catalogue/crops/page.tsx · THE CROP LENS (PC-56 ADMIN-3c, canon W023).
//
// THE CANON'S OWN SCHEMA NOTE IS RENDERED ON THE PAGE, because it is the thing a reader most needs to know and the thing
// they would otherwise infer wrongly: there is no crops table. A crop IS a category in the `crops.*` branch, and this
// screen is a lens.
//
// TWO ABSENCES THAT MUST NOT READ AS FACTS — both of which are what DELTA-008 actually turned out to be about:
//   1. A crop with no sourced calendar has UNKNOWN seasons. Not "no seasons". W023 previously showed a `pending` badge on
//      the column header because the data had no home; it has one now, and the honest value is "unknown" for a crop
//      nobody has sourced a calendar for.
//   2. A crop with NO PRODUCTS is not "unmapped" — there is nothing to map. A red badge there would never clear and would
//      be a criticism of nothing.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { SEASONS, seasonsText, seasonsUnknown, mandiClass, mandiKey, type CropRow } from '../../../features/catalogue/crops';

import { Callout, Chip, EmptyState, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('crop.title'), robots: { index: false, follow: false } };
}

interface CropsView { items: CropRow[]; seasons: string[]; basis: string }

export default async function CropsPage({ searchParams }: { searchParams: { season?: string } }) {
  requireAdmin();
  const t = getTranslator();

  const season = (SEASONS as readonly string[]).includes(searchParams.season ?? '') ? searchParams.season : undefined;

  let view: CropsView | null = null; let notice: string | undefined;
  try { view = (await adminGet<CropsView>('catalogue/crops')).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const all = view?.items ?? [];
  // filtered in the console: the lens is 214 rows and bounded, so a season chip is a view rather than a query
  const rows = season ? all.filter((c) => (c.seasons ?? []).includes(season)) : all;

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue">{t.t('cat.back')}</Link></p>
      <h1>{t.t('crop.title')}</h1>
      <p className="kv-muted">{t.t('crop.lead')}</p>
      {/* the schema truth and the two derivations, said once */}
      <Callout>{view?.basis ?? t.t('crop.basis')}</Callout>

      <nav className="kv-filters" aria-label={t.t('cat.nav')}>
        <Chip as={Link} href="/catalogue">{t.t('cat.navTypes')}</Chip>
        <Chip as={Link} href="/catalogue/categories">{t.t('cat.navCategories')}</Chip>
        <Chip as={Link} href="/catalogue/attributes">{t.t('cat.navAttributes')}</Chip>
        <Chip as={Link} href="/catalogue/units">{t.t('cat.navUnits')}</Chip>
        <Chip as={Link} href="/catalogue/translations">{t.t('cat.navTranslations')}</Chip>
        <Chip as={Link} href="/catalogue/crops" aria-current="true" active>{t.t('cat.navCrops')}</Chip>
      </nav>

      <nav className="kv-filters" aria-label={t.t('crop.seasons')}>
        <Chip as={Link} href="/catalogue/crops" active={!season}>{t.t('attr.filterAllTypes')}</Chip>
        {SEASONS.map((s) => (
          <Chip as={Link} key={s} href={`/catalogue/crops?season=${s}`} active={season === s}>
            {t.t(`crop.season.${s}`)}
          </Chip>
        ))}
      </nav>

      <p className="kv-field__hint"><Link href="/catalogue/crop-calendars">{t.t('cal.title')}</Link></p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : rows.length === 0 ? (
        <EmptyState title={t.t('crop.none')} />
      ) : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('crop.name')}</th>
            <th scope="col">{t.t('crop.path')}</th>
            <th scope="col">{t.t('crop.varieties')}</th>
            <th scope="col">{t.t('crop.seasons')}</th>
            <th scope="col">{t.t('crop.calendars')}</th>
            <th scope="col">{t.t('crop.products')}</th>
            <th scope="col">{t.t('crop.mandi')}</th>
          </tr></thead>
          <tbody>
            {rows.map((c) => {
              const unknown = seasonsUnknown(c);
              const label = seasonsText(c);
              const state = c.mandi?.state;
              const key = mandiKey(state);
              return (
                <tr key={c.id}>
                  <td>{c.defaultName}</td>
                  <td><code>{c.path}</code></td>
                  <td>{c.varietyCount > 0 ? String(c.varietyCount) : t.t('common.dash')}</td>
                  <td>
                    {/* UNKNOWN, not a dash — a dash could read as "none" */}
                    {unknown || !label
                      ? <StatusPill tone="neutral" label={t.t('crop.seasonsUnknown')} title={t.t('crop.seasonsUnknownHint')} />
                      : label.split(' · ').map((s) => t.t(`crop.season.${s}`)).join(' · ')}
                  </td>
                  <td>
                    {c.calendarCount > 0
                      ? <Link href={`/catalogue/crop-calendars?categoryId=${encodeURIComponent(c.id)}`}>{c.calendarCount}</Link>
                      : t.t('common.dash')}
                  </td>
                  <td>{c.productCount > 0 ? String(c.productCount) : t.t('common.dash')}</td>
                  <td>
                    <Link href={`/catalogue/crops/${encodeURIComponent(c.id)}`}>
                      <span className={`kv-status ${mandiClass(state)}`}
                        title={key === 'noProducts' ? t.t('crop.mandi.noProductsHint') : undefined}>
                        {key === 'partial'
                          ? t.t('crop.mandi.partial', { mapped: String(c.mandi?.mapped ?? 0), total: String(c.mandi?.total ?? 0) })
                          : t.t(`crop.mandi.${key}`)}
                      </span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
