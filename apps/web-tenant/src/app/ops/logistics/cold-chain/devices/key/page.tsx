// apps/web-tenant/src/app/ops/logistics/cold-chain/devices/key/page.tsx · issue a logger's signing key — PC-56 TENANT-SW-e. The key
// binds the logger to ONE subject; a new key revokes the previous one. It is stored encrypted (13a envelope) and shown once.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../../../lib/session';
import { tenantHasPerm } from '../../../../../../lib/auth';
import { getTranslator } from '../../../../../../lib/i18n';
import { COLD_SUBJECT_TYPES, DEVICES_HREF, SWE_CODES, isUuid } from '../../../../../../features/swe/console';
import { IssueKeyPanel } from './IssueKeyPanel';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.key.issue'), robots: { index: false, follow: false } }; }
const LABEL_KEYS = ['swe.key.issued', 'swe.key.once', 'swe.key.copy', 'swe.key.copied', 'swe.key.copyFailed', 'swe.key.hide', 'swe.key.replayed', 'swe.key.hint', 'swe.key.previousRevoked',
  'swe.key.rule', 'swe.key.working', 'swe.key.issue', 'swe.cold.col.kind', 'swe.cold.col.subject', 'swe.reason', 'mutate.failure.title', 'form.failure.untouched', 'form.backToScreen', 'mutate.cancel', 'swe.code.unknown'];

export default async function IssueKeyPage({ searchParams }: { searchParams: { deviceId?: string } }) {
  await requireSession(DEVICES_HREF);
  const t = getTranslator();
  const deviceId = isUuid(searchParams.deviceId) ? searchParams.deviceId : null;
  if (!tenantHasPerm('logistics.devices.manage')) return <section><h1>{t.t('swe.key.issue')}</h1><div className="kv-card kv-card--notice" role="alert"><strong>{t.t('swe.state.restricted.title')}</strong><p>{t.t('swe.state.restricted.body')}</p></div></section>;
  const labels: Record<string, string> = Object.fromEntries([...LABEL_KEYS, ...SWE_CODES.map((c) => `swe.code.${c}`)].map((k) => [k, t.t(k)]));
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.cold.devices')}><Link href={DEVICES_HREF}>{t.t('swe.cold.devices')}</Link> / <span aria-current="page">{t.t('swe.key.issue')}</span></nav>
      <h1>{t.t('swe.key.issue')}</h1>
      {!deviceId ? <div className="kv-error" role="alert"><p>{t.t('swe.state.notFound.body')}</p></div>
        : <IssueKeyPanel deviceId={deviceId} subjectTypes={COLD_SUBJECT_TYPES.map((s) => ({ value: s, label: t.t(`swe.cold.kind.${s}`) }))} labels={labels} idempotencyKey={randomUUID()} backHref={DEVICES_HREF} />}
    </section>
  );
}
