// apps/web-storefront/src/components/BrowseFacets.tsx · PC-56 STORE-2a · C1 (canon W275 facets + chips) — the facet groups WITH their capped
// counts (grade · organic claim · district · sale type, from the API's one bounded statement) as links, and the active filters as chips.
// Every link is built by features/store2a/browse.ts: it sets ONE parameter, keeps the rest, and drops the cursor. Above the cap the API
// withholds the counts (a sample would be a false number) and this says so instead of printing figures. Grade = the CONFIRMED grade
// (founder D2); "Ungraded" counts the lots no person graded.
import { formatNumber } from '@krishalaya/i18n';
import { getTranslator, getLang } from '../lib/i18n';
import type { Chip, FacetLink, FacetView } from '../features/store2a/browse';

function Group({ id, title, links }: { id: string; title: string; links: FacetLink[] }) {
  const lang = getLang();
  if (links.length === 0) return null;
  return (
    <fieldset className="kv-facet" data-kv-facet={id}>
      <legend className="kv-filters__label">{title}</legend>
      <ul>
        {links.map((l) => (
          <li key={l.id}>
            <a href={l.href} className={l.active ? 'kv-facet__link kv-facet__link--on' : 'kv-facet__link'} {...(l.active ? { 'aria-current': 'true' as const } : {})}>
              {l.label} <span className="kv-facet__count">({formatNumber(l.count, lang)})</span>
            </a>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export function BrowseFacets({ facets, chips }: { facets: FacetView | null; chips: Chip[] }) {
  const t = getTranslator();
  return (
    <div className="kv-facets">
      {chips.length > 0 && (
        <ul className="kv-chips" aria-label={t.t('browse.chips.label')}>
          {chips.map((c) => (
            <li key={c.key}>
              <a href={c.href} className="kv-chip" data-kv-chip={c.key} aria-label={t.t('browse.chips.remove', { filter: c.label })}>
                {c.label} <span aria-hidden="true">×</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {facets ? (
        <>
          <Group id="grade" title={t.t('browse.facet.grade')} links={facets.grade} />
          <Group id="organic" title={t.t('browse.facet.organic')} links={facets.organic} />
          <Group id="district" title={t.t('browse.facet.district')} links={facets.district} />
          <Group id="saleType" title={t.t('discover.saleType')} links={facets.saleType} />
        </>
      ) : (
        <p className="kv-state" data-kv-state="facets-withheld">{t.t('browse.facets.withheld')}</p>
      )}
    </div>
  );
}
