// apps/web-admin/src/app/not-found.tsx · localized 404 for the god-mode console (server component).
import Link from 'next/link';
import { getTranslator } from '../lib/i18n';

import { Button, EmptyState } from '@krishalaya/ui';
export default function NotFound() {
  const t = getTranslator();
  return (
    <EmptyState variant="empty" title={t.t('common.notFoundTitle')} titleAs="h1" body={t.t('common.notFoundBody')}>
      <Button as={Link} href="/dashboard">{t.t('common.backToDashboard')}</Button>
    </EmptyState>
  );
}
