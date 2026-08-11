// apps/web-tenant/src/app/get-started/page.tsx · W116, the go-live checklist (PC-56 TENANT-1c).
//
// **THERE IS NO CHECKLIST TABLE, AND THAT IS THE POINT.** Each of the six steps is a FACT that already exists — the tenant
// row, a subscription, a verified business-KYC profile, two staff, one member, a penny-verified bank account — so the state
// cannot drift from reality and nobody can tick a box for something that did not happen. The timestamps W116 shows ("done ·
// today 11:20") are the facts' own `created_at`, which means they cannot be backdated either.
//
// My own earlier note called this "the checklist whose six unlock steps no table records", as though the gap were a missing
// table. It was the opposite: a table here would be a second opinion about things the database already knows, and it could
// say "KYC done" after a rejection. A setup screen that lies about readiness lets a federation go live believing money can
// move.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import type { GoLiveState } from '@krishalaya/sdk-js';
import { stepBadge, nextStep } from '../../features/console/home';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('golive.title'), robots: { index: false, follow: false } };
}

/** Where each step sends somebody. Kept beside the page rather than in the API: a route is a console fact. */
const STEP_HREF: Record<string, string> = {
  organisation: '/settings',
  plan: '/billing',
  kyc: '/kyc',
  team: '/team',
  members: '/people/import',
  payouts: '/payouts',
};

export default async function GetStartedPage() {
  await requireSession('/get-started');
  const t = getTranslator();
  const lang = getLang();

  let s: GoLiveState | null = null;
  let restricted = false;
  let failed = false;
  try {
    s = await tenantClient().consoleHome.goLive();
  } catch (e) {
    // W116's restricted state: "Only the organisation owner and tenant_admin roles see setup — staff land on their work
    // desks instead." So a staff member is pointed at their desk rather than shown an error.
    if ((e as { status?: number })?.status === 403) restricted = true;
    else failed = true;
  }

  if (restricted) {
    return (
      <section>
        <h1>{t.t('golive.title')}</h1>
        <p className="kv-notice" role="status">{t.t('golive.restricted')}</p>
        <p><Link href="/dashboard" className="kv-link">{t.t('golive.toDashboard')}</Link></p>
      </section>
    );
  }
  if (failed || !s) {
    return (
      <section>
        <h1>{t.t('golive.title')}</h1>
        {/* W116: "Your setup progress is safe on the server." — because it is not stored anywhere else. */}
        <p className="kv-error" role="alert">{t.t('golive.loadError')}</p>
      </section>
    );
  }

  const next = nextStep(s);

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('golive.title')}</h1>
        <p className="kv-muted">
          {s.live ? t.t('golive.liveSubtitle') : t.t('golive.subtitle')}
        </p>
        <p className="kv-fine">
          {t.t('golive.progress', { done: s.progress.done, total: s.progress.total })}
          {' · '}{t.t('golive.notBillable')}
        </p>
      </div>

      {/* **THE COMPLETED STATE IS A REAL STATE, NOT AN EMPTY LIST.** W116: "Your federation is live. This page becomes your
          health check — it returns whenever something needs attention." So the page stays, and says so. */}
      {s.live && (
        <p className="kv-success" role="status">
          {t.t('golive.allDone')} <Link href="/dashboard" className="kv-link">{t.t('golive.toDashboard')}</Link>
        </p>
      )}

      {/* The one thing to do next, called out above the list — because a six-item list with one actionable row buries it. */}
      {next && (
        <p className="kv-notice" role="status">
          {t.t('golive.nextIs', { step: t.t(`golive.step.${next.key}`) })}{' '}
          <Link href={STEP_HREF[next.key] ?? '/dashboard'} className="kv-link">{t.t(`golive.cta.${next.key}`)}</Link>
        </p>
      )}

      <ol className="kv-notif-list">
        {s.steps.map((step, i) => {
          const badge = stepBadge(step);
          return (
            <li key={step.key} className="kv-notif-item">
              <span className="kv-notif-title">
                {i + 1}. {t.t(`golive.step.${step.key}`)}
                {' '}<span className="kv-badge">{t.t(`golive.badge.${badge}`)}</span>
              </span>
              <span className="kv-notif-meta">
                {t.t(`golive.why.${step.key}`)}
                {/* **A TIMESTAMP ONLY WHEN THE STEP IS DONE.** The API returns null otherwise, so a rejected KYC attempt's
                    date can never appear beside an unticked step and read as "done at 11:20". */}
                {step.doneAt ? ` · ${t.t('golive.doneAt', { date: formatDate(step.doneAt, lang) })}` : ''}
                {/* Only `payouts` is ever genuinely blocked, and only by KYC — money cannot move before verification.
                    Everything else is merely ordered, and telling a federation otherwise makes the product feel
                    bureaucratic for no reason. */}
                {step.blockedBy ? ` · ${t.t('golive.blockedBy', { step: t.t(`golive.step.${step.blockedBy}`) })}` : ''}
              </span>
              {/* The counts behind the two threshold steps, so a federation can see WHY a step is not done rather than only
                  that it is not: "1 of 2 staff" is actionable, an unticked box is not. */}
              {step.key === 'team' && !step.done && (
                <span className="kv-fine">{t.t('golive.teamCount', { n: s!.staffCount })}</span>
              )}
              {step.key === 'members' && !step.done && (
                <span className="kv-fine">{t.t('golive.memberCount', { n: s!.memberCount })}</span>
              )}
              {!step.done && !step.blockedBy && (
                <span className="kv-actions">
                  <Link href={STEP_HREF[step.key] ?? '/dashboard'} className="kv-btn--link">
                    {t.t(`golive.cta.${step.key}`)}
                  </Link>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* W116's own reassurances, kept because they are the reason a federation trusts the page. */}
      <p className="kv-fine kv-note">{t.t('golive.membersSeeNothing')}</p>
      <p className="kv-fine kv-note">{t.t('golive.helpLanguages')}</p>
      {/* And the honest absence: a step somebody wants to dismiss ("we do not use payouts") cannot be dismissed, because
          there is nothing to record a dismissal in — the whole design derives from facts. Named rather than half-built. */}
      <p className="kv-fine kv-note">{t.t('golive.noDismiss')}</p>
    </section>
  );
}
