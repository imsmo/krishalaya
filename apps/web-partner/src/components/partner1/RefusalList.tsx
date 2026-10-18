// apps/web-partner/src/components/partner1/RefusalList.tsx · PC-56 PARTNER-1a · founder D7 (survey E1) — the canon claims a surface does NOT make,
// printed BY NAME from features/partner1/refusals.ts (ported from the storefront's RefusalList). Presentational: the translator is passed in, so
// the render tests render exactly this component. A refusal is a sentence that says no — never an offer, never a silent gap.
import type { Tr } from '../NotYet';
import { PARTNER1_REFUSALS, type Partner1Surface } from '../../features/partner1/refusals';

export function RefusalList({ t, surface }: { t: Tr; surface: Partner1Surface }) {
  const rows = PARTNER1_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('partner1.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}
