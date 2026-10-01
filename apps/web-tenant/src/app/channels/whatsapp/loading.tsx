// apps/web-tenant/src/app/channels/whatsapp/loading.tsx · the loading state of every WhatsApp screen (PC-56 TENANT-8e).
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  return <p className="kv-loading" role="status" aria-live="polite">{getTranslator().t('wa.loading')}</p>;
}
