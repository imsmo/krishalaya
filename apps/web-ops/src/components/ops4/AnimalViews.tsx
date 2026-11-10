// apps/web-ops/src/components/ops4/AnimalViews.tsx · PC-56 OPS-4b · W394 `/animals/eartag-scan`, W395 `/animals/register`, W396 `/animals/transfer` —
// HONEST pages in the OPS-1c kiosk chrome (founder Q4-A, Q5-A, applied by the lead from HOTFIX-10 "a known phone reveals nothing" and OPS-1c
// Q8-A "consent is hers"). They READ NOTHING (no `opsClient`, no `/v1/*`; the component takes no data) and have ZERO inputs. Each prints its words
// first, then the kiosk statement (the desk creates an account for a new number; everything after that she does herself), the links between the
// three pages and the kiosk home (the edges the canon never drew), and every refused canon line BY NAME. No animal, tag, owner, breed, photo or
// person is ever shown on this console.
// Q4's second sentence ("An owner sees her animals and their tags in her own app.") is NOT printed: at merge the owner's app shows only the last
// four digits of each tag — a false premise, reported (wave report §6), never reworded here.
import Link from 'next/link';
import type { Tr } from '../../features/ops4/refusals';
import { ANIMALS } from '../../features/ops4/upkeep';
import { KIOSK_HOME } from '../../features/ops1/kiosk';
import { KioskStatement } from '../ops1/KioskViews';
import { Ops4Refusals } from './Ops4Chain';
import { AnimalLinks, STEM, type AnimalSurface } from './AnimalLinks';

export type { AnimalSurface } from './AnimalLinks';
/** Each page's words, in order — the founder's (Q4-A / Q5-A) and one fact the code proves (W396). */
export const ANIMAL_WORDS: Readonly<Record<AnimalSurface, readonly string[]>> = {
  eartag: ['ops4.q4.words'],
  animal_register: ['ops4.q5.register'],
  animal_transfer: ['ops4.q5.transfer', 'ops4.animals.tagStays'],
};

export function AnimalHonestView({ t, surface }: { t: Tr; surface: AnimalSurface }) {
  const stem = STEM[surface];
  return (
    <section data-kv-ops4={surface} data-kv-state="honest">
      <h1>{t.t(`ops4.animals.${stem}.title`)}</h1>
      <div className="kv-card" data-kv-statement={surface}>
        {ANIMAL_WORDS[surface].map((k) => <p key={k} className="kv-statement" data-kv-statement={k}>{t.t(k)}</p>)}
        <p data-kv-fact="reads-nothing">{t.t('ops4.animals.readsNothing')}</p>
      </div>
      <KioskStatement t={t} />
      <AnimalLinks t={t} except={surface} />
      <p className="kv-pager">
        <Link className="kv-btn--link" href={KIOSK_HOME} data-kv-real="home">{t.t('ops1.kiosk.start.homeLink')}</Link>
        {surface === 'eartag' ? <>{' '}<Link className="kv-btn kv-btn--muted" href={`${ANIMALS.eartag}?act=confirm`} data-kv-decor="retry">{t.t('ops4.error.retry')}</Link></> : null}
      </p>
      <Ops4Refusals t={t} surface={surface} />
    </section>
  );
}
