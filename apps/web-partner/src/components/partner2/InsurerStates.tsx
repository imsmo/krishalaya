// apps/web-partner/src/components/partner2/InsurerStates.tsx · PC-56 PARTNER-2a — the two SWITCHED-OFF states every insurer page shares: the
// partner console OFF (`partner_console`: "switched off … nothing is broken", PARTNER-0's words) and the platform's insurance OFF (`insurance`:
// "insurance is switched off on the platform — nothing is broken"). Never "unavailable", never an outage for a switch.
import type { Tr } from '../NotYet';

export function InsurerSwitchedOff({ t, which, page }: { t: Tr; which: 'off' | 'insurance_off'; page: string }) {
  if (which === 'off') {
    return <section data-kv-insurer={page} data-kv-state="off"><h1>{t.t('partner.off.title')}</h1><p className="kv-muted">{t.t('partner.off.body')}</p></section>;
  }
  return (
    <section data-kv-insurer={page} data-kv-state="insurance_off">
      <h1>{t.t('partner2.insuranceOff.title')}</h1>
      <p className="kv-muted">{t.t('partner2.insuranceOff.body')}</p>
    </section>
  );
}
