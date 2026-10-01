// apps/web-tenant/src/app/comms/loading.tsx · the broadcast plane's loading state (PC-56 TENANT-8e).
import { getTranslator } from '../../lib/i18n';

export default function Loading() {
  return <p className="kv-loading" role="status" aria-live="polite">{getTranslator().t('bc.loading')}</p>;
}
