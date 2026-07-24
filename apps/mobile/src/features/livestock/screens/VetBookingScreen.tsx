// apps/mobile/src/features/livestock/screens/VetBookingScreen.tsx · screen · [P2]
// DEV-11 (2026-07-24, Group-B EmptyState pass set 1): canon ref `screens/206-farmer-vet-booking.html`
// ("206 · Book a Vet"). Behind `livestock` (DEV-08 census §2 Group-B genuine gap — zero `(livestock)` route
// group anywhere in `app/**`; master-plan §2.2 row 5 "Livestock... GA Wave 3", pilot-OFF). Golden Law 8:
// flag-gated honest EmptyState, mirroring the QA-verified pattern at `app/(farmer)/create-auction.tsx`
// (`useFlag('auctions')` + real `EmptyState` on OFF). PLACEMENT (DEV-11 decision, see dev11_report.md §1):
// un-routed in `features/` on purpose — zero nav entry exists anywhere for `livestock` (grep-verified) — this
// is the honest component-level fix, not new routing the pilot IA never called for.
import React from 'react';
import { ScreenScaffold, EmptyState } from '@krishi-verse/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { offModuleState } from '../../../core/flags/off-module-state';

export default function VetBookingScreen() {
  const { t } = useTranslation();
  const enabled = useFlag('livestock');
  const state = offModuleState(enabled);
  return (
    <ScreenScaffold title={t('livestockVetBooking.title')}>
      <EmptyState
        title={state === 'off' ? t('common.unavailable') : t('common.comingSoon')}
        message={state === 'comingSoon' ? t('livestock.comingSoonMsg') : undefined}
        testID="vet-booking-empty-state"
      />
    </ScreenScaffold>
  );
}
