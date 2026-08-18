// apps/web-admin/src/app/templates/page.tsx · W101 (PC-56 ADMIN-11b).
//
// The notification template registry: platform defaults per event × channel × language, and every tenant override.
//
// **THE COLUMN THIS SCREEN GAINS IS "WOULD THIS ACTUALLY SEND".** Before this wave the list could only show
// `is_active`, and 0072's `lifecycle_status` — draft, submitted, approved, rejected, paused — was written and read by no
// code at all: `resolve()` sent on `is_active` alone, so a template WhatsApp had REJECTED looked live here and sent
// anyway, which is how a business number gets blocked.
//
// **AND THE OVERRIDES COLUMN DISTINGUISHES A ZERO FROM A NEVER.** W101: "auth.otp and dispute events are opt-out-locked
// and tenant overrides are disabled on them — security copy stays platform-controlled." Nothing enforced that in either
// realm until this wave; the count next to OTP is not "none yet", it is "none possible".
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { getTranslator } from '../../lib/i18n';
import { Button, Callout, Chip, EmptyState, StatusPill } from '@krishalaya/ui';
import {
  channelKey, lifecycleTone, lifecycleKey, overridesKey, securityOverrideClass, securityOverrideKey,
  sendStateTone, sendStateKey, unversionedKey, type TemplateListRow,
} from '../../features/templates/template';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('tp11.title'), robots: { index: false, follow: false } };
}

interface Meta {
  nextCursor: string | null;
  eventsInCatalogue: number; platformTemplates: number; channelsCovered: number; liveLanguages: number;
  providerApprovalsPending: number; unversioned: number; securityCopyOverrides: number;
  providerSubmissionOwner: string;
}

const CHANNELS = ['push', 'sms', 'whatsapp', 'email', 'inapp', 'ivr'] as const;

export default async function TemplatesPage({ searchParams }: {
  searchParams: { channel?: string; languageCode?: string; eventCode?: string; cursor?: string; ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const channel = (CHANNELS as readonly string[]).includes(searchParams.channel ?? '') ? searchParams.channel : undefined;
  const lang = (searchParams.languageCode ?? '').trim().slice(0, 8) || undefined;

  let rows: TemplateListRow[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const q = new URLSearchParams();
    if (channel) q.set('channel', channel);
    if (lang) q.set('languageCode', lang);
    if (searchParams.eventCode) q.set('eventCode', searchParams.eventCode);
    if (searchParams.cursor) q.set('cursor', searchParams.cursor);
    const res = await adminGet<TemplateListRow[]>(`templates?${q.toString()}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'tp11.restricted' : 'tp11.error.list';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/dashboard">{t.t('nav.dashboard')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('tp11.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('tp11.title')}</h1>
        <p className="kv-page__sub">{t.t('tp11.sub')}</p>
      </header>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`tp11.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`tp11.err.${searchParams.error}`)}</Callout> : null}

      {meta ? (
        <>
          <section className="kv-stats" aria-label={t.t('tp11.census')}>
            <div className="kv-stat"><dt>{t.t('tp11.stat.events')}</dt><dd>{meta.eventsInCatalogue.toLocaleString('en-IN')}</dd></div>
            <div className="kv-stat"><dt>{t.t('tp11.stat.templates')}</dt><dd>{meta.platformTemplates.toLocaleString('en-IN')}</dd></div>
            <div className="kv-stat"><dt>{t.t('tp11.stat.channels')}</dt><dd>{meta.channelsCovered}</dd></div>
            {/* "DLT / WA approvals pending · provider_template_ref missing" — counted from the SERVING version, because
                the registration belongs to the words and not to the row. */}
            <div className="kv-stat"><dt>{t.t('tp11.stat.pending')}</dt><dd>{meta.providerApprovalsPending}</dd></div>
          </section>

          {/* **THE AUDIT QUERY FROM MIGRATION 0122, RUN ON EVERY PAGE LOAD, PRINTED WHETHER IT IS ZERO OR NOT.** A panel
              that appears only when something is wrong is a panel nobody trusts when it is absent. */}
          <p className={securityOverrideClass(meta.securityCopyOverrides)}>
            {t.t(securityOverrideKey(meta.securityCopyOverrides), { n: String(meta.securityCopyOverrides) })}
          </p>
          <Callout tone="info">{t.t(unversionedKey(meta.unversioned), { n: String(meta.unversioned) })}</Callout>
        </>
      ) : null}

      <nav className="kv-filters" aria-label={t.t('tp11.filterGroup')}>
        <Chip as={Link} href="/templates" active={!channel && !lang}>{t.t('common.all')}</Chip>
        {CHANNELS.map((c) => (
          <Chip as={Link} key={c} href={`/templates?channel=${c}`} active={channel === c}>
            {t.t(channelKey(c))}
          </Chip>
        ))}
        <Chip as={Link} href="/templates/coverage">{t.t('tp11.gapsOnly')}</Chip>
        <Chip as={Link} href="/templates/senders">{t.t('tp11.senders')}</Chip>
      </nav>

      {rows.length === 0 && !notice ? (
        // The canon's own empty state: "gaps view shows what is missing, not what exists".
        <EmptyState title={t.t('tp11.empty.title')} body={t.t('tp11.empty.body')}>
          <Button as={Link} href="/templates/coverage">{t.t('tp11.gapsOnly')}</Button>
        </EmptyState>
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('tp11.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('tp11.col.event')}</th>
              <th scope="col">{t.t('tp11.col.channel')}</th>
              <th scope="col">{t.t('tp11.col.lang')}</th>
              <th scope="col">{t.t('tp11.col.preview')}</th>
              <th scope="col">{t.t('tp11.col.ref')}</th>
              <th scope="col">{t.t('tp11.col.overrides')}</th>
              <th scope="col">{t.t('tp11.col.sends')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/templates/${r.id}`} className="kv-mono">{r.eventCode}</Link>
                  {r.tenantName ? <><br /><small>{t.t('tp11.overrideOf', { tenant: r.tenantName })}</small></> : null}
                  {/* [QA-FIX 2026-08-15] was hardcoded tone="neutral", discarding the original `kv-badge is-warn` modifier. */}
                  {r.securityCopy ? <><br /><StatusPill tone="warning" icon={false} label={t.t('tp11.securityBadge')} /></> : null}
                </td>
                <td>{t.t(channelKey(r.channel))}</td>
                <td className="kv-mono">{r.languageCode}</td>
                {/* The SERVING wording, read from the immutable version — not from the row a save used to overwrite. */}
                <td>{r.body.slice(0, 60)}{r.body.length > 60 ? '…' : ''}</td>
                <td className="kv-mono">
                  {/* [QA-FIX 2026-08-15] was hardcoded tone="neutral", discarding the original `kv-badge is-danger`
                      modifier — a missing required provider template ref is a blocking-send condition. */}
                  {r.providerTemplateRef ?? (r.providerRefRequired
                    ? <StatusPill tone="danger" icon={false} label={t.t('tp11.ref.missing')} />
                    : <span>{t.t('tp11.ref.na')}</span>)}
                </td>
                <td>{t.t(overridesKey(r), { n: String(r.overrideCount) })}</td>
                <td>
                  <StatusPill tone={sendStateTone(r)} label={t.t(sendStateKey(r))} />
                  <br /><StatusPill tone={lifecycleTone(r.lifecycle)} label={t.t(lifecycleKey(r.lifecycle))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {meta?.nextCursor ? (
        <nav className="kv-pager" aria-label={t.t('common.pagination')}>
          <Button as={Link} href={`/templates?${channel ? `channel=${channel}&` : ''}cursor=${encodeURIComponent(meta.nextCursor)}`}>
            {t.t('common.next')}
          </Button>
        </nav>
      ) : null}

      {meta ? <Callout tone="info"><small>{t.t('tp11.submissionNote', { owner: meta.providerSubmissionOwner })}</small></Callout> : null}
    </main>
  );
}
