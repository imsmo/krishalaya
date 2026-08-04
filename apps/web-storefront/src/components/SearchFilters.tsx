// apps/web-storefront/src/components/SearchFilters.tsx · the storefront discovery controls. A plain
// <form method="get"> (server component — works WITHOUT client JS): submitting writes the chosen facets into the
// URL searchParams, so every filtered view is a shareable, bookmarkable link and the back button just works.
// The cursor is intentionally NOT a field, so changing a filter restarts paging from the first page. categoryId/
// regionId, if present in the URL, ride along as hidden inputs so they survive a filter change. All copy via i18n.
import { getTranslator } from '../lib/i18n';
import { SALE_TYPES, SORTS, minorToMajor, parseMajorToMinor, type RawSearchParams } from '../features/discovery/query';
import type { CategoryOption } from '../features/discovery/categories';
import type { RegionOption } from '../features/discovery/regions';

export function SearchFilters({ basePath, sp, categories = [], regions = [] }: { basePath: string; sp: RawSearchParams; categories?: CategoryOption[]; regions?: RegionOption[] }) {
  const t = getTranslator();
  const cur = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) ?? '';
  const saleType = cur('saleType');
  const sort = cur('sort');
  const categoryId = cur('categoryId');
  const regionId = cur('regionId');

  return (
    <form method="get" action={basePath} className="kv-filters" role="search" aria-label={t.t('discover.filtersLabel')}>
      <div className="kv-filters__row">
        <div className="kv-filters__field kv-filters__field--grow">
          <label htmlFor="f-q" className="kv-filters__label">{t.t('discover.searchLabel')}</label>
          <input id="f-q" name="q" type="search" defaultValue={cur('q')} placeholder={t.t('discover.searchPlaceholder')} className="kv-field__input" />
        </div>

        <div className="kv-filters__field">
          <label htmlFor="f-sale" className="kv-filters__label">{t.t('discover.saleType')}</label>
          <select id="f-sale" name="saleType" defaultValue={saleType} className="kv-field__input">
            <option value="">{t.t('discover.saleType.any')}</option>
            {SALE_TYPES.map((s) => <option key={s} value={s}>{t.t(`discover.saleType.${s}`)}</option>)}
          </select>
        </div>

        <div className="kv-filters__field">
          <label htmlFor="f-sort" className="kv-filters__label">{t.t('discover.sort')}</label>
          <select id="f-sort" name="sort" defaultValue={sort} className="kv-field__input">
            {SORTS.map((s) => <option key={s} value={s}>{t.t(`discover.sort.${s}`)}</option>)}
          </select>
        </div>

        {categories.length > 0 && (
          <div className="kv-filters__field">
            <label htmlFor="f-cat" className="kv-filters__label">{t.t('discover.category')}</label>
            <select id="f-cat" name="categoryId" defaultValue={categoryId} className="kv-field__input">
              <option value="">{t.t('discover.category.any')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        )}

        {regions.length > 0 && (
          <div className="kv-filters__field">
            <label htmlFor="f-region" className="kv-filters__label">{t.t('discover.region')}</label>
            <select id="f-region" name="regionId" defaultValue={regionId} className="kv-field__input">
              <option value="">{t.t('discover.region.any')}</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="kv-filters__row">
        <div className="kv-filters__field">
          <label htmlFor="f-min" className="kv-filters__label">{t.t('discover.priceMin')}</label>
          <input id="f-min" name="priceMin" type="text" inputMode="decimal" defaultValue={minorToMajor(parseMajorToMinor(cur('priceMin')))} className="kv-field__input" />
        </div>
        <div className="kv-filters__field">
          <label htmlFor="f-max" className="kv-filters__label">{t.t('discover.priceMax')}</label>
          <input id="f-max" name="priceMax" type="text" inputMode="decimal" defaultValue={minorToMajor(parseMajorToMinor(cur('priceMax')))} className="kv-field__input" />
        </div>
        <div className="kv-filters__field kv-filters__field--check">
          <label htmlFor="f-organic" className="kv-filters__check">
            <input id="f-organic" name="organic" type="checkbox" value="1" defaultChecked={cur('organic') === '1'} />
            {t.t('discover.organicOnly')}
          </label>
        </div>

        <div className="kv-filters__actions">
          {/* carry tenant-scoped passthrough filters that have no visible control. categoryId rides as a hidden
              input ONLY when the category <select> isn't shown (no lookup available) so it survives a filter change. */}
          {categories.length === 0 && categoryId && <input type="hidden" name="categoryId" value={categoryId} />}
          {regions.length === 0 && regionId && <input type="hidden" name="regionId" value={regionId} />}
          <button type="submit" className="kv-btn">{t.t('discover.apply')}</button>
          <a href={basePath} className="kv-btn--link">{t.t('discover.clear')}</a>
        </div>
      </div>
    </form>
  );
}
