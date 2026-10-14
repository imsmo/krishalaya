// apps/web-storefront/src/components/SearchFilters.tsx · the storefront discovery controls. A plain
// <form method="get"> (server component — works WITHOUT client JS): submitting writes the chosen facets into the
// URL searchParams, so every filtered view is a shareable, bookmarkable link and the back button just works.
// The cursor is intentionally NOT a field, so changing a filter OR THE SORT restarts paging from the first page (a cursor belongs to its
// sort — the API refuses a cursor of another sort). All copy via i18n.
//
// PC-56 STORE-2a · C1: the category is `category` (the WHOLE subtree — the canon's `/c/[...path]` is a recorded DELTA); the organic choice
// is the SPLIT (any · certified · natural — it was one checkbox that the API read "false" as true); the grade and the district are chosen
// from the facet links beside the form (with their counts), and ride along here as hidden fields so a form submit keeps them. "Nearest
// first" is not a sort (founder D3 — refused by name on the page). Canon W3080's "Apply filters → confirm" is a DELTA: applying a filter is
// a read, no confirm step.
import { getTranslator } from '../lib/i18n';
import { SALE_TYPES, SORTS, LEGACY_DEFAULT_EXPONENT, minorToMajor, parseMajorToMinor, type RawSearchParams } from '../features/discovery/query';
import type { CategoryOption } from '../features/discovery/categories';
import type { RegionOption } from '../features/discovery/regions';

// PC-56 STORE-1b: `exponent` = the store currency's minor-unit exponent (features/discovery/money.ts); null = unknown → nothing is guessed:
// the price fields start empty and the band is not applied, rather than re-read with a guessed two decimals.
// `hideSaleTypes` (PC-56 STORE-1b): a sale type the store has switched off (group lots, from storefront.flags()) is not offered as a facet.
export function SearchFilters({ basePath, sp, categories = [], exponent = LEGACY_DEFAULT_EXPONENT, hideSaleTypes = [] }: { basePath: string; sp: RawSearchParams; categories?: CategoryOption[]; regions?: RegionOption[]; exponent?: number | null; hideSaleTypes?: readonly string[] }) {
  const t = getTranslator();
  const cur = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) ?? '';
  const saleType = cur('saleType');
  const sort = cur('sort');
  const category = cur('category') || cur('categoryId');
  const organicRaw = cur('organic');
  const organic = organicRaw === '1' || organicRaw === 'true' ? 'any' : organicRaw;
  const grade = cur('grade');
  const district = cur('district');

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
            {SALE_TYPES.filter((s) => !hideSaleTypes.includes(s)).map((s) => <option key={s} value={s}>{t.t(`discover.saleType.${s}`)}</option>)}
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
            <select id="f-cat" name="category" defaultValue={category} className="kv-field__input">
              <option value="">{t.t('discover.category.any')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="kv-filters__row">
        <div className="kv-filters__field">
          <label htmlFor="f-min" className="kv-filters__label">{t.t('discover.priceMin')}</label>
          <input id="f-min" name="priceMin" type="text" inputMode="decimal" defaultValue={exponent === null ? '' : minorToMajor(parseMajorToMinor(cur('priceMin'), exponent), exponent)} className="kv-field__input" />
        </div>
        <div className="kv-filters__field">
          <label htmlFor="f-max" className="kv-filters__label">{t.t('discover.priceMax')}</label>
          <input id="f-max" name="priceMax" type="text" inputMode="decimal" defaultValue={exponent === null ? '' : minorToMajor(parseMajorToMinor(cur('priceMax'), exponent), exponent)} className="kv-field__input" />
        </div>
        <div className="kv-filters__field">
          <label htmlFor="f-organic" className="kv-filters__label">{t.t('browse.organic.label')}</label>
          <select id="f-organic" name="organic" defaultValue={organic} className="kv-field__input">
            <option value="">{t.t('browse.organic.none')}</option>
            <option value="any">{t.t('browse.organic.any')}</option>
            <option value="certified">{t.t('browse.organic.certified')}</option>
            <option value="natural">{t.t('browse.organic.natural')}</option>
          </select>
        </div>

        <div className="kv-filters__actions">
          {/* the facet-link choices ride along so a form submit keeps them; a category with no picker (lookup down) rides along too */}
          {categories.length === 0 && category && <input type="hidden" name="category" value={category} />}
          {grade && <input type="hidden" name="grade" value={grade} />}
          {district && <input type="hidden" name="district" value={district} />}
          <button type="submit" className="kv-btn">{t.t('discover.apply')}</button>
          <a href={basePath} className="kv-btn--link">{t.t('discover.clear')}</a>
        </div>
      </div>
    </form>
  );
}
