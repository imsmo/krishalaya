// apps/web-ops/src/components/ops4/AnimalLinks.tsx · PC-56 OPS-4b — the links between the three animal pages (W394–W396), drawn from the kiosk home
// (W380) and from each animal page: the edges the canon never drew (W395 and W396 had 0 inbound links). Its own file so the kiosk home and the
// animal pages share it without importing each other.
import Link from 'next/link';
import type { Tr } from '../../features/ops4/refusals';
import { ANIMALS } from '../../features/ops4/upkeep';

export type AnimalSurface = 'eartag' | 'animal_register' | 'animal_transfer';
export const STEM: Record<AnimalSurface, string> = { eartag: 'eartag', animal_register: 'register', animal_transfer: 'transfer' };
const HREF: Record<AnimalSurface, string> = { eartag: ANIMALS.eartag, animal_register: ANIMALS.register, animal_transfer: ANIMALS.transfer };

export function AnimalLinks({ t, except }: { t: Tr; except?: AnimalSurface }) {
  return (
    <ul className="kv-list" data-kv-links="animals">
      {(Object.keys(HREF) as AnimalSurface[]).filter((s) => s !== except).map((s) => (
        <li key={s}><Link className="kv-link" href={HREF[s]} data-kv-edge={s}>{t.t(`ops4.animals.${STEM[s]}.title`)}</Link></li>
      ))}
    </ul>
  );
}

