// apps/mobile/src/features/fpo-coordinator/screens/CreateGroupLotScreen.tsx · screen · [P2]
// DEV-12 (2026-07-24, Group-B EmptyState pass set 2): canon ref `screens/370-farmer-create-group.html`
// ("370 · Create Group" — nearest concept — no literal group-lot creation screen exists; nearest existing farmer-group-creation pattern). Behind `fpo_coordinator` (DEV-08 census §2 Group-B genuine gap — zero
// `(fpo-coordinator)` route group anywhere in `app/**`; not named in master-plan §2.1/§2.2 at all — founder-approved
// mirror-DEV-11 scope, DEV-S1 sitting 2026-07-24, Founder Review Queue item 2). Golden Law 8: flag-gated honest
// EmptyState, mirroring the QA-verified pattern at `app/(farmer)/create-auction.tsx`
// (`useFlag('auctions')` + real `EmptyState` on OFF). PLACEMENT (mirrors DEV-11's dev11_report.md §1): this file
// stays un-routed in `features/` on purpose — zero nav entry exists anywhere in the app for `fpo_coordinator` (no tab,
// no menu item, no `router.push` call to this area, grep-verified), so adding a new `(fpo-coordinator)` route group
// would invent navigation the pilot IA never called for. This component-level fix removes the theoretical
// MF-01-class black-void risk (Law 12) if a future batch ever does wire a nav entry or import this file directly,
// without over-building routing today.
import React from 'react';
import { ScreenScaffold, EmptyState } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { offModuleState } from '../../../core/flags/off-module-state';

export default function CreateGroupLotScreen() {
  const { t } = useTranslation();
  const enabled = useFlag('fpo_coordinator');
  const state = offModuleState(enabled);
  return (
    <ScreenScaffold title={t('fpoCoordinatorCreateGroupLot.title')}>
      <EmptyState
        title={state === 'off' ? t('common.unavailable') : t('common.comingSoon')}
        message={state === 'comingSoon' ? t('fpoCoordinator.comingSoonMsg') : undefined}
        testID="fpo-create-group-lot-empty-state"
      />
    </ScreenScaffold>
  );
}
