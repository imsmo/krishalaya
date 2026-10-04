// apps/web-tenant/src/app/people/ambassadors/AuditEntryCard.tsx · the mutate chain's success screen shows THE AUDIT ENTRY
// the act wrote — actor, role, time, reason, before → after — read back from the trail (GET /audit/entries, masked as the
// trail always is), never re-typed from the form. When the reader may not open the trail (`audit.read`) or it is switched
// off, the card says so and links to it, rather than printing fields it did not read · PC-56 TENANT-10a.
import Link from 'next/link';
import type { AuditEntry } from '@krishalaya/sdk-js';
import type { Translator } from '@krishalaya/i18n';
import { formatDate } from '@krishalaya/i18n';
import { tenantClient } from '../../../lib/api-client';
import { auditHref } from '../../../features/forms/chain';

export async function AuditEntryCard({ t, lang, entityType, entityId, action }: { t: Translator; lang: string; entityType: string; entityId: string | null; action: string }) {
  let entry: AuditEntry | null = null; let unreadable = false;
  // [PC-56 TENANT-SW-f] a tenant-wide act (the wastage re-run) has no single entity: the latest entry of the action, newest first
  try { entry = (await tenantClient().audit.list({ entityType, ...(entityId ? { entityId } : {}), action, limit: 1 })).items[0] ?? null; } catch { unreadable = true; }
  const json = (v: unknown) => (v === null || v === undefined ? t.t('form.nothingStored') : JSON.stringify(v));
  return (
    <div className="kv-card">
      <h2>{t.t('amb.audit.title')}</h2>
      {entry ? (
        <dl className="kv-detail">
          <dt>{t.t('amb.audit.action')}</dt><dd><code>{entry.action}</code></dd>
          <dt>{t.t('amb.audit.actor')}</dt><dd>{entry.actorRole ?? t.t('amb.audit.notRecorded')}</dd>
          <dt>{t.t('amb.audit.time')}</dt><dd>{formatDate(entry.createdAt, lang, { dateStyle: 'medium', timeStyle: 'medium' })}</dd>
          <dt>{t.t('amb.audit.reason')}</dt><dd>{entry.reason ?? t.t('amb.audit.noReason')}</dd>
          <dt>{t.t('amb.audit.before')}</dt><dd><code>{json(entry.oldValue)}</code></dd>
          <dt>{t.t('amb.audit.after')}</dt><dd><code>{json(entry.newValue)}</code></dd>
        </dl>
      ) : <p className="kv-field__hint">{t.t(unreadable ? 'amb.audit.unreadable' : 'amb.audit.notYet')}</p>}
      {entityId && <p><Link href={auditHref(entityType, entityId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
    </div>
  );
}
