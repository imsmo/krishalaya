// apps/mobile/src/app/+not-found.tsx · the expo-router GLOBAL unmatched-route fallback (Law 12). A stale/bad deep
// link or a route that no longer exists lands here instead of white-screening: a friendly "not found" panel with a
// one-tap way back to the home tab. Static (no backend) — renders regardless of flags / auth. Thin screen (guide §3).
import React from 'react';
import { useRouter } from 'expo-router';
import { EmptyState, ScreenScaffold } from '@krishalaya/ui-native';
import { useTranslation } from '../core/i18n/useTranslation';

export default function NotFound() {
  const { t } = useTranslation();
  const router = useRouter();
  const goHome = () => { try { router.replace('/'); } catch { /* best-effort */ } };
  return (
    <ScreenScaffold title={t('system.notFound.title')}>
      <EmptyState
        title={t('system.notFound.heading')}
        message={t('system.notFound.message')}
        actionLabel={t('system.notFound.home')}
        onAction={goHome}
        testID="not-found"
      />
    </ScreenScaffold>
  );
}
