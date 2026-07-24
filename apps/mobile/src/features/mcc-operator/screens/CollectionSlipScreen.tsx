// apps/mobile/src/features/mcc-operator/screens/CollectionSlipScreen.tsx · screen · [P2]
// DEV-12 (2026-07-24, Group-B EmptyState pass set 2): canon ref `screens/237-worker-mcc-collection-entry.html`
// ("237 · MCC Collection Entry"). Behind `mcc_operator` (DEV-08 census §2 Group-B genuine gap — zero
// `(mcc-operator)` route group anywhere in `app/**`; not named in master-plan §2.1/§2.2 at all — founder-approved
// mirror-DEV-11 scope, DEV-S1 sitting 2026-07-24, Founder Review Queue item 2). Golden Law 8: flag-gated honest
// EmptyState, mirroring the QA-verified pattern at `app/(farmer)/create-auction.tsx`
// (`useFlag('auctions')` + real `EmptyState` on OFF). PLACEMENT (mirrors DEV-11's dev11_report.md §1): this file
// stays un-routed in `features/` on purpose — zero nav entry exists anywhere in the app for `mcc_operator` (no tab,
// no menu item, no `router.push` call to this area, grep-verified), so adding a new `(mcc-operator)` route group
// would invent navigation the pilot IA never called for. This component-level fix removes the theoretical
// MF-01-class black-void risk (Law 12) if a future batch ever does wire a nav entry or import this file directly,
// without over-building routing today.
import React from 'react';
import { ScreenScaffold, EmptyState } from '@krishi-verse/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { offModuleState } from '../../../core/flags/off-module-state';

export default function CollectionSlipScreen() {
  const { t } = useTranslation();
  const enabled = useFlag('mcc_operator');
  const state = offModuleState(enabled);
  return (
    <ScreenScaffold title={t('mccOperatorCollectionSlip.title')}>
      <EmptyState
        title={state === 'off' ? t('common.unavailable') : t('common.comingSoon')}
        message={state === 'comingSoon' ? t('mccOperator.comingSoonMsg') : undefined}
        testID="collection-slip-empty-state"
      />
    </ScreenScaffold>
  );
}
