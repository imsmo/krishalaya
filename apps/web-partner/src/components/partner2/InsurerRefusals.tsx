// apps/web-partner/src/components/partner2/InsurerRefusals.tsx · PC-56 PARTNER-2a (survey E1) — the canon claims an insurer surface does NOT make,
// printed BY NAME from features/partner2/refusals.ts (the partner1 RefusalList's shape). Presentational: the translator is passed in, so the
// render tests render exactly this component. A refusal is a sentence that says no — never an offer, never a silent gap.
import type { Tr } from '../NotYet';
import { PARTNER2_REFUSALS, type Partner2Surface } from '../../features/partner2/refusals';

export function InsurerRefusals({ t, surface }: { t: Tr; surface: Partner2Surface }) {
  const rows = PARTNER2_REFUSALS.filter((r) => r.surfaces.includes(surface));
  if (rows.length === 0) return null;
  return (
    <section className="kv-refused" data-kv-refused={surface} aria-labelledby={`kv-refused-${surface}`}>
      <h2 id={`kv-refused-${surface}`} className="kv-card__title">{t.t('partner2.refused.title')}</h2>
      <ul>{rows.map((r) => <li key={r.id} className="kv-refusal" data-kv-refusal={r.id}>{t.t(r.key)}</li>)}</ul>
    </section>
  );
}
