// apps/mobile/src/features/dairy/screens/MilkBillScreen.tsx · screen · [P2]
// DEV-11 (2026-07-24, Group-B EmptyState pass set 1): canon ref `screens/227-farmer-dairy-payout-detail.html`
// ("227 · Dairy Payout Detail"). Behind `dairy` (DEV-08 census §2 Group-B genuine gap — zero `(dairy)` route
// group anywhere in `app/**`; master-plan §2.2 row 4 "Dairy/MCC... GA Wave 3", pilot-OFF). Golden Law 8:
// flag-gated honest EmptyState, mirroring the QA-verified pattern at `app/(farmer)/create-auction.tsx`
// (`useFlag('auctions')` + real `EmptyState` on OFF). PLACEMENT (DEV-11 decision, see dev11_report.md §1):
// un-routed in `features/` on purpose — zero nav entry exists anywhere for `dairy` (grep-verified) — this is
// the honest component-level fix, not new routing the pilot IA never called for.
import React from 'react';
import { ScreenScaffold, EmptyState } from '@krishi-verse/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { offModuleState } from '../../../core/flags/off-module-state';

export default function MilkBillScreen() {
  const { t } = useTranslation();
  const enabled = useFlag('dairy');
  const state = offModuleState(enabled);
  return (
    <ScreenScaffold title={t('dairyMilkBill.title')}>
      <EmptyState
        title={state === 'off' ? t('common.unavailable') : t('common.comingSoon')}
        message={state === 'comingSoon' ? t('dairy.comingSoonMsg') : undefined}
        testID="milk-bill-empty-state"
      />
    </ScreenScaffold>
  );
}
