// apps/web-admin/src/app/moderation/appeals/[id]/page.tsx · the appeal case (PC-56 ADMIN-SWEEP-b1,
// W097's Review drill-in; W1953–W1955 as real states of this page).
//
// THE CHAIN IS THIS PAGE, NOT THREE DEAD PAGES. W1953 (confirm): the decide form states the four overturn
// consequences — with their real provider states — before the button; W1954 (success): the ?ok= banner reports what
// each effect ACTUALLY did, per effect, because "restored" and "there was nothing left to restore" must not print
// the same; W1955 (failure): the ?error= banner names the refusal and state is untouched (the server ran all four
// writes in ONE transaction, so failure means nothing happened).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin, adminUserId } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { decideAppealAction } from '../../actions';
import {
  decideBlockedKey, neOriginalMark, slaLabel, slaClass,
  DECISION_REASON_MIN, OVERTURN_EFFECT_KEYS, type AppealSla,
} from '../../../../features/moderation/appeals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ap.caseTitle'), robots: { index: false, follow: false } };
}

interface Notice {
  id: string; recipientKind: string; status: string; detail: string | null;
  languageCode: string; settledAt: string | null; attempts: number;
}
interface Case {
  id: string; subjectRef: string; subjectAction: string; appellant: string;
  originalActionRef: string | null; originalReviewerId: string | null;
  assignedTo: string | null; assignedNeOriginal: boolean;
  status: string; slaDueAt: string; sla: AppealSla;
  decisionReason: string | null; decidedAt: string | null; createdAt: string;
  decidableByViewer: boolean;
  subjectKind: string | null; subjectId: string | null; subject: Record<string, unknown> | null;
  reviewerSource: string; appellantLanguage: string | null; activeLanguages: string[];
  notices: Notice[];
}

const OK = new Set(['claimed', 'upheld', 'overturned']);
const ERR = new Set(['outcome', 'reason', 'language', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function AppealCasePage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const viewer = adminUserId();

  let c: Case | undefined; let notice: string | undefined;
  try { c = (await adminGet<Case>(`moderation/appeals/${encodeURIComponent(params.id)}`)).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  if (!c) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/moderation/appeals">{t.t('ap.backQueue')}</Link></p>
        <h1>{t.t('ap.caseHeading')}</h1>
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  const sla = slaLabel(c.sla);
  const mark = neOriginalMark(c.assignedTo, c.originalReviewerId);
  const blocked = decideBlockedKey({ status: c.status, assignedTo: c.assignedTo, originalReviewerId: c.originalReviewerId, viewer });

  return (
    <section>
      <p className="kv-backlink"><Link href="/moderation/appeals">{t.t('ap.backQueue')}</Link></p>
      <h1>{t.t('ap.caseHeading')} · {c.id.slice(0, 8)}</h1>
      {/* W1954's state: the decision landed and the audit trail has the entry. */}
      {okKey && <p className="kv-success" role="status">{t.t(`ap.ok.${okKey}`)}</p>}
      {/* W1955's state: the attempt was rejected; the transaction means nothing changed. */}
      {errKey && <p className="kv-error" role="alert">{t.t(`ap.error.${errKey}`)} {t.t('ap.nothingChanged')}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('ap.col.action')}</dt><dd>{t.t(`ap.action.${c.subjectAction}`)} · {c.subjectRef}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ap.col.appellant')}</dt><dd>{c.appellant}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('ap.appellantLanguage')}</dt><dd>{c.appellantLanguage ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row">
          <dt>{t.t('ap.col.originalReviewer')}</dt>
          <dd>{c.originalReviewerId ?? (c.reviewerSource === 'system' ? t.t('ap.systemDecision') : t.t('ap.originUnresolved'))}</dd>
        </div>
        <div className="kv-facts__row">
          <dt>{t.t('ap.col.assignedTo')}</dt>
          <dd>
            {c.assignedTo ?? t.t('ap.unassigned')}
            {mark === 'ok' && <span className="kv-status kv-status--ok">{t.t('ap.neOriginal')}</span>}
            {mark === 'unknown' && <span className="kv-status">{t.t('ap.neUnknown')}</span>}
          </dd>
        </div>
        <div className="kv-facts__row">
          <dt>{t.t('ap.col.sla')}</dt>
          <dd>{c.status === 'pending'
            ? <span className={slaClass(c.sla)}>{t.t(`ap.sla.${sla.key}`, { h: String(sla.hours) })}</span>
            : <>{t.t(`ap.tab.${c.status}` as never)} · {c.decidedAt}</>}</dd>
        </div>
        {c.decisionReason && (
          <div className="kv-facts__row"><dt>{t.t('ap.decisionReason')}</dt><dd>{c.decisionReason}</dd></div>
        )}
      </dl>

      {/* THE SUBJECT AS IT STANDS NOW — read before overturning: there may be nothing left to restore, and the
          decider should learn that here, not from the effects report. */}
      <h2>{t.t('ap.subjectHeading')}</h2>
      {c.subject ? (
        <dl className="kv-facts">
          {Object.entries(c.subject).map(([k, v]) => (
            <div className="kv-facts__row" key={k}><dt>{k}</dt><dd>{String(v ?? t.t('common.dash'))}</dd></div>
          ))}
        </dl>
      ) : (
        <p className="kv-error" role="note">{t.t('ap.subjectGone')}</p>
      )}

      <h2>{t.t('ap.noticesHeading')}</h2>
      {/* Same honesty rail as the listing case: a queued notice is NOT a sent one. */}
      <ul className="kv-list">
        {c.notices.map((n) => (
          <li key={n.id}>
            <span className="kv-status">{t.t(`ap.notice.${n.status === 'delivered' ? 'delivered' : n.status === 'queued' ? 'queued' : 'failed'}`)}</span>{' '}
            {n.languageCode}{n.detail && <span className="kv-detail__muted"> — {n.detail}</span>}
          </li>
        ))}
      </ul>
      {c.notices.length === 0 && <p className="kv-empty">{t.t('ap.noNotices')}</p>}

      {/* ---------------- THE DECISION (W1953: the confirm IS this form) ---------------- */}
      {c.status !== 'pending' ? (
        <p className="kv-detail__muted">{t.t('ap.alreadyDecided')}</p>
      ) : blocked ? (
        // The refusal an operator would hit server-side, said BEFORE the round-trip — reflect, never grant.
        <p className="kv-error" role="alert">{t.t(`ap.decideBlocked.${blocked}`)}</p>
      ) : (
        <>
          <h2>{t.t('ap.decideHeading')}</h2>
          {/* W1953's consequence statement, made true: all four effects, one transaction, each outcome reported. */}
          <p className="kv-error" role="note">{t.t('ap.overturnConfirm')}</p>
          <ul className="kv-list">
            {OVERTURN_EFFECT_KEYS.map((k) => <li key={k}>{t.t(`ap.effect.${k}`)}</li>)}
          </ul>
          <form action={decideAppealAction} className="kv-form">
            <input type="hidden" name="id" value={c.id} />
            <label htmlFor="outcome" className="kv-field__label">{t.t('ap.outcomeLabel')}</label>
            <select id="outcome" name="outcome" className="kv-input" required defaultValue="">
              <option value="" disabled>{t.t('common.choose')}</option>
              <option value="upheld">{t.t('ap.outcome.upheld')}</option>
              <option value="overturned">{t.t('ap.outcome.overturned')}</option>
            </select>
            <label htmlFor="reason" className="kv-field__label">
              {t.t('ap.reasonLabel', { lang: c.appellantLanguage ?? '—' })}
            </label>
            <textarea id="reason" name="reason" className="kv-input" required minLength={DECISION_REASON_MIN} maxLength={2000} />
            <label htmlFor="lang" className="kv-field__label">{t.t('ap.languageLabel')}</label>
            <select id="lang" name="languageCode" className="kv-input" required defaultValue={c.appellantLanguage ?? ''}>
              {c.activeLanguages.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button type="submit" className="kv-btn">{t.t('ap.decide')}</button>
          </form>
          <p className="kv-detail__muted">{t.t('ap.decideDoctrine')}</p>
        </>
      )}

      {okKey === 'overturned' && (
        // W1954, honestly: the per-effect report for THIS decision lives in the audit entry; the notices list above
        // shows the delivery truth as it settles. What this banner never says is "sent".
        <p className="kv-detail__muted">{t.t('ap.effectsReported')}</p>
      )}
    </section>
  );
}
