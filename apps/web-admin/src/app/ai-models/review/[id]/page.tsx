// apps/web-admin/src/app/ai-models/review/[id]/page.tsx · W083 (PC-56 ADMIN-7).
//
// "Humans decide; AI proposes." · "Recorded to ai_review_queue + inference marked was_overridden if rejected."
//
// THE SECOND HALF OF THAT SENTENCE IS NOT YET TRUE FOR A PLATFORM OFFICER, AND THIS PAGE SAYS SO. `ai_inferences` is
// append-only for every application role (0014), and 0115 grants admin-api SELECT and revokes the rest — a god-mode realm
// that could edit the record of what the platform's models decided should not exist. So a platform rejection is recorded
// on the CASE, and the inference's `was_overridden` flag is set by apps/api, which owns the tenant unit of work. Until
// ADMIN-7-Q8's executor exists, W085's override rate under-counts platform-side rejections — and the fairness board shows
// that count rather than leaving somebody to discover it.
//
// THE DECISION NOTE IS THE POINT, not a courtesy. W083 says it "teaches the model" and W085's entire override analysis is
// built out of these sentences ("commodity price spikes read as manipulation"). A resolved case with an empty note is a
// training signal thrown away, so the floor is 20 characters in the form, in Zod, and in 0115's CHECK.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { claimCaseAction, decideCaseAction } from '../../actions';
import { Button, Callout, StatusPill } from '@krishalaya/ui';
import {
  ageMinutes, claimAction, claimKey, kindTone, kindKey, reviewerRealmKey,
} from '../../../../features/ai-governance/ai-governance';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ai.case.title'), robots: { index: false, follow: false } };
}

interface CaseDetail {
  id: string; tenantId: string | null; inferenceId: string | null; queueKind: string;
  priority: number; status: string; reviewerUserId: string | null; reviewerAdminId: string | null;
  claimedAt: string | null; decisionNote: string | null; resolvedAt: string | null; createdAt: string;
  claim: { kind: string; who?: string | null; since?: string | null; status?: string };
  crossChecks: { available: boolean; reason: string };
}

export default async function ReviewCasePage({ params, searchParams }: {
  params: { id: string };
  searchParams: { ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  let c: CaseDetail | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<CaseDetail | null>(`ai/review/cases/${encodeURIComponent(params.id)}`);
    c = res.data ?? null;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = e instanceof AdminApiError && e.status === 403 ? 'ai.restricted.case' : 'ai.error.case';
  }
  if (!c && !notice) notFound();

  const action = c ? claimAction(c.claim.kind) : null;
  const age = c ? ageMinutes(c.createdAt, Date.now()) : null;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/ai-models">{t.t('nav.aiModels')}</Link> <span aria-hidden="true">/</span>{' '}
        <Link href="/ai-models/review">{t.t('ai.review.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{params.id.slice(0, 8)}</span>
      </nav>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`ai.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`ai.err.${searchParams.error}`)}</Callout> : null}

      {c ? (
        <>
          <header className="kv-page__head">
            <h1>{params.id.slice(0, 8)} — <StatusPill tone={kindTone(c.queueKind)} label={t.t(kindKey(c.queueKind))} /></h1>
            <p className="kv-page__sub">
              {t.t(claimKey(c.claim.kind))} · {t.t('ai.col.priority')} {c.priority}
              {age !== null ? ` · ${t.t('ai.age.minutes', { m: String(age) })}` : ''}
              {c.tenantId ? ` · ${c.tenantId.slice(0, 8)}` : ` · ${t.t('ai.tenant.platform')}`}
            </p>
          </header>

          {/* ---------------- THE AI'S PROPOSAL ---------------- */}
          <section className="kv-panel" aria-labelledby="ai-proposal">
            <h2 id="ai-proposal" className="kv-panel__title">{t.t('ai.case.proposal')}</h2>
            {c.inferenceId ? (
              <p>
                {t.t('ai.case.inference', { id: c.inferenceId })}{' '}
                {/* The full output lives on the decision explorer, which is gated on the READ permission — a reviewer who
                    can decide can also look, and a reader who can look cannot decide. */}
                <Link href={`/ai-models/decisions?overriddenOnly=false`}>{t.t('ai.case.openExplorer')}</Link>
              </p>
            ) : (
              <Callout tone="warning">{t.t('ai.case.noInference')}</Callout>
            )}
          </section>

          {/* ---------------- CROSS-CHECKS ---------------- */}
          <section className="kv-panel" aria-labelledby="ai-xcheck">
            <h2 id="ai-xcheck" className="kv-panel__title">{t.t('ai.case.crossChecks')}</h2>
            {/* W083 shows "Context the model can't see" and a Mandi Pulse cross-check. NOT BUILT, and said so: the mandi
                lookup would read `mandi_prices` through the subject, which is the same per-subject-type join `district`
                needs (ADMIN-7-Q4) — and a cross-check panel that ran no checks would be a reassurance with nothing behind
                it, which is the exact defect this plane keeps producing. */}
            <Callout tone="warning">{t.t('ai.case.crossChecksAbsent')}</Callout>
          </section>

          {/* ---------------- THE DECISION ---------------- */}
          <section className="kv-panel" aria-labelledby="ai-decide">
            <h2 id="ai-decide" className="kv-panel__title">{t.t('ai.case.decision')}</h2>

            {c.status === 'accepted' || c.status === 'rejected' ? (
              <>
                <p>
                  {t.t('ai.case.decided', { status: c.status, at: (c.resolvedAt ?? '').slice(0, 16).replace('T', ' ') })}
                  {' · '}{t.t(reviewerRealmKey(c.reviewerUserId, c.reviewerAdminId))}
                </p>
                {c.decisionNote ? <p className="kv-pre">{c.decisionNote}</p> : null}
                <Callout>{t.t('ai.case.notReopened')}</Callout>
              </>
            ) : action === 'decide' ? (
              <form action={decideCaseAction}>
                <input type="hidden" name="id" value={c.id} />
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="ai-note">{t.t('ai.case.note')}</label>
                  <textarea className="kv-input" id="ai-note" name="note" minLength={20} maxLength={4000} required
                    aria-describedby="ai-note-help" />
                  <p className="kv-field__help" id="ai-note-help">{t.t('ai.case.noteHelp')}</p>
                </div>
                {/* TWO SUBMITS, ONE FORM, and the labels say what each does to the model rather than "OK" and "Cancel":
                    accepting means the human agreed with the AI, rejecting means they disagreed and the model was wrong. */}
                <Button type="submit" name="decision" value="accept">
                  {t.t('ai.case.accept')}
                </Button>
                <Button type="submit" name="decision" value="reject" variant="danger">
                  {t.t('ai.case.reject')}
                </Button>
                <Callout>{t.t('ai.case.rejectMeaning')}</Callout>
              </form>
            ) : action === 'take' || action === 'takeover' ? (
              <form action={claimCaseAction}>
                <input type="hidden" name="id" value={c.id} />
                {/* A decision may only be made FROM a claim: `pending` → `accepted` in one step would mean nobody was ever
                    recorded as holding the case, which is the single-owner rule defeated by skipping a step. */}
                <Callout>{t.t('ai.case.mustClaim')}</Callout>
                {action === 'takeover' ? (
                  <Callout tone="warning">{t.t('ai.case.takeoverWarning', { who: c.claim.who?.slice(0, 8) ?? '—' })}</Callout>
                ) : null}
                <Button type="submit">{t.t(`ai.action.${action}`)}</Button>
              </form>
            ) : (
              // Held by somebody else, recently. The control is NOT drawn — cases are single-owner so two people cannot
              // reach conflicting decisions on the same farmer's listing.
              <Callout tone="warning" live="polite">
                {t.t('ai.case.heldByOther', { who: c.claim.who?.slice(0, 8) ?? '—' })}
              </Callout>
            )}
          </section>

          {/* The honest limit of a platform decision, stated where the decision is made. */}
          <Callout>{t.t('ai.case.flagCaveat')}</Callout>
        </>
      ) : null}
    </main>
  );
}
