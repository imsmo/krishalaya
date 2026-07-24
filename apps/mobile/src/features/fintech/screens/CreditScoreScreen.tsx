// apps/mobile/src/features/fintech/screens/CreditScoreScreen.tsx · screen · [P2]
// DEV-11 (2026-07-24, Group-B EmptyState pass set 1): canon ref `screens/260-farmer-credit-score-view.html`
// ("260 · Credit Score View"). Behind `fintech` (DEV-08 census §2 Group-B genuine gap — zero `(fintech)` route
// group anywhere in `app/**`; master-plan §2.2 row 2 "Fintech/schemes... GA Wave 2", pilot-OFF). Golden Law 8:
// flag-gated honest EmptyState, mirroring the QA-verified pattern at `app/(farmer)/create-auction.tsx`
// (`useFlag('auctions')` + real `EmptyState` on OFF). PLACEMENT (DEV-11 decision, see dev11_report.md §1): this
// file stays un-routed in `features/` on purpose — zero nav entry exists anywhere in the app for `fintech` (no
// tab, no menu item, no `router.push` call to this area, grep-verified), so adding a new `(fintech)` route group
// would invent navigation the pilot IA never called for. This component-level fix removes the theoretical
// MF-01-class black-void risk (Law 12) if a future batch ever does wire a nav entry or import this file directly,
// without over-building routing today.
import React from 'react';
import { ScreenScaffold, EmptyState } from '@krishi-verse/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { offModuleState } from '../../../core/flags/off-module-state';

export default function CreditScoreScreen() {
  const { t } = useTranslation();
  const enabled = useFlag('fintech');
  const state = offModuleState(enabled);
  return (
    <ScreenScaffold title={t('fintechCreditScore.title')}>
      <EmptyState
        title={state === 'off' ? t('common.unavailable') : t('common.comingSoon')}
        message={state === 'comingSoon' ? t('fintech.comingSoonMsg') : undefined}
        testID="credit-score-empty-state"
      />
    </ScreenScaffold>
  );
}
