// apps/web-admin/src/app/compliance/consent/purposes/[code]/page.tsx · W047's version ladder and notice authoring
// (PC-56 ADMIN-5b).
//
// A consent notice is the words a person read before agreeing to let us process their data. Two consequences run through
// this page:
//   • ONCE PUBLISHED, NEVER EDITED. A published version's notices are immutable at the database (a trigger, not a
//     convention), because its words are what somebody agreed to. Editing is only offered on a draft.
//   • PUBLISHING IS CHECKER-GATED. W047: "version bumps are maker-checker". The Publish control is ABSENT when the viewer
//     drafted the version, and absent again when a MANDATORY purpose has a language missing — that second case is not a
//     permissions problem, it is the platform declining to obtain consent under a notice somebody cannot read.
//
// The fourth rung of W047's ladder — "re-consent prompts roll out" — does not exist. Nothing compares a person's held
// version against the current one at the point of use. What this page can do is SIZE the job, which is the number
// somebody needs before they build the prompt.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin, adminUserId } from '../../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../../lib/admin-client';
import { getTranslator } from '../../../../../lib/i18n';
import { adminNoticeKey } from '../../../../../features/nav/nav-model';
import {
  versionKind, versionClass, showsSignature, openDraft, publishBlockedReason,
  reConsentNeeded, reConsentTotal, NOTICE_MIN_CHARS,
  type ConsentVersionRow, type ReConsentBacklog,
} from '../../../../../features/compliance/consent';
import { openConsentDraftAction, saveConsentNoticeAction, publishConsentVersionAction, discardConsentDraftAction } from '../../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cns.purposeDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['drafted', 'noticeSaved', 'published', 'discarded']);
const ERR = new Set([
  'changeReason', 'isMandatory', 'languageCode', 'toggleLabel', 'noticeTooShort', 'noticeTooLong', 'markup',
  'noticeIsLabel', 'secondPerson', 'noticeMissing', 'notDraft', 'draftOpen', 'consentInvalid',
  'elevation', 'conflict', 'invalid', 'notFound', 'generic',
]);

interface PurposeDetail {
  code: string; defaultName: string; isMandatory: boolean; currentVersion: string;
  languages: string[];
  versions: ConsentVersionRow[];
  reConsent: ReConsentBacklog;
  reConsentPrompt: { available: boolean; reason: string };
  ivrEvidence: { available: boolean };
}

export default async function ConsentPurposeDetailPage({ params, searchParams }: { params: { code: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let p: PurposeDetail | undefined; let notice: string | undefined;
  try { p = (await adminGet<PurposeDetail>(`consent/purposes/${encodeURIComponent(params.code)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }
  if (!p) {
    return <section><p className="kv-backlink"><Link href="/compliance/consent/purposes">{t.t('cns.backPurposes')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const draft = openDraft(p.versions);
  // DISPLAY GATING ONLY — reads the UNVERIFIED `sub` claim. The authority is `ck_cpv_maker_ne_checker` plus the server's
  // 409; null means "cannot tell", and the safe direction there is to show the control and let the server refuse.
  const viewerId = adminUserId();
  const block = publishBlockedReason(draft, viewerId);
  const backlogTotal = reConsentTotal(p.reConsent);

  return (
    <section>
      <p className="kv-backlink"><Link href="/compliance/consent/purposes">{t.t('cns.backPurposes')}</Link></p>
      <h1>{p.code} <span className="kv-muted">{p.currentVersion}</span></h1>
      <p className="kv-muted">{p.defaultName}</p>
      {p.isMandatory && <p className="kv-notice">{t.t('cns.mandatoryNote')}</p>}
      {okKey && <p className="kv-success" role="status">{t.t(`cns.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cns.error.${errKey}`)}</p>}

      {/* The size of the job W047's fourth rung promises and nothing performs. Three numbers because they need three
          different actions — and the unresolvable ones cannot be prompted meaningfully at all, because nobody knows what
          those people agreed to. */}
      <h2>{t.t('cns.reConsentHeading')}</h2>
      {backlogTotal === null ? <p className="kv-empty">{t.t('cns.reConsentUnknown')}</p> : (
        <dl className="kv-facts">
          <div className="kv-facts__row"><dt>{t.t('cns.holdingCurrent')}</dt><dd>{String(p.reConsent.holdingCurrent)}</dd></div>
          <div className="kv-facts__row">
            <dt>{t.t('cns.holdingSuperseded')}</dt>
            <dd>
              {String(p.reConsent.holdingSuperseded)}{' '}
              {reConsentNeeded(p.reConsent) && <span className="kv-status kv-status--warn">{t.t('cns.needsPrompt')}</span>}
            </dd>
          </div>
          <div className="kv-facts__row">
            <dt>{t.t('cns.holdingUnresolvable')}</dt>
            <dd>{String(p.reConsent.unresolvable)} <span className="kv-detail__muted">{t.t('cns.unresolvableWhy')}</span></dd>
          </div>
        </dl>
      )}
      {!p.reConsentPrompt.available && <p className="kv-notice">{t.t('cns.noPromptMechanism')}</p>}

      <h2>{t.t('cns.versionsHeading')}</h2>
      <ul className="kv-timeline">
        {p.versions.map((v) => {
          const kind = versionKind(v);
          return (
            <li key={v.id} className="kv-timeline__item">
              <p className="kv-timeline__head">
                {v.version} <span className={versionClass(kind)}>{t.t(`cns.vk.${kind}`)}</span>{' '}
                {v.isMandatory && <span className="kv-status kv-status--warn">{t.t('cns.isMandatory')}</span>}
              </p>
              <p>{v.changeReason}</p>
              <p className="kv-detail__muted">
                {v.notices.length === 0
                  // Every backfilled version is here. The words its consents were given against were never recorded.
                  ? t.t('cns.noNoticesOnVersion')
                  : t.t('cns.coverageLine', { have: String(v.coverage.covered.length), total: String(v.coverage.total), missing: v.coverage.missing.join(', ') || '—' })}
              </p>
              {showsSignature(v)
                ? <p className="kv-detail__muted">{t.t('cns.signedBy', { who: v.publishedBy ?? '', when: v.publishedAt ?? '' })}{v.checkerNote ? ` — ${v.checkerNote}` : ''}</p>
                : <p className="kv-detail__muted">{t.t(kind === 'backfilled' ? 'cns.unsignedBackfilled' : 'cns.unsignedDraft')}</p>}
              {v.notices.length > 0 && (
                <ul className="kv-list">
                  {v.notices.map((n) => (
                    <li key={n.languageCode}>
                      <strong>{n.languageCode}</strong> — {n.toggleLabel}
                      <br /><span className="kv-detail__muted">{n.noticeText}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {p.versions.length === 0 && <p className="kv-empty">{t.t('cns.noVersions')}</p>}

      {draft ? (
        <>
          <h2>{t.t('cns.draftHeading', { v: draft.version })}</h2>
          <p className="kv-notice">{t.t('cns.draftNothingLive')}</p>

          <h3>{t.t('cns.authorHeading')}</h3>
          {/* One language per call. Twelve languages is twelve deliberate acts — a bulk field is how eleven of them end
              up machine-translated in one gesture, and a machine-translated consent notice is not a notice. */}
          <form action={saveConsentNoticeAction} className="kv-card kv-action-card">
            <input type="hidden" name="code" value={p.code} />
            <input type="hidden" name="versionId" value={draft.id} />
            <label className="kv-field__label" htmlFor="languageCode">{t.t('cns.language')}</label>
            <select id="languageCode" name="languageCode" className="kv-input" defaultValue={p.languages[0] ?? 'en'}>
              {p.languages.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <label className="kv-field__label" htmlFor="toggleLabel">{t.t('cns.toggleLabel')}</label>
            <input id="toggleLabel" name="toggleLabel" className="kv-input" required maxLength={150} />
            <p className="kv-field__hint">{t.t('cns.toggleLabelHint')}</p>
            <label className="kv-field__label" htmlFor="noticeText">{t.t('cns.noticeText')}</label>
            <input id="noticeText" name="noticeText" className="kv-input" required minLength={NOTICE_MIN_CHARS} maxLength={4000} />
            <p className="kv-field__hint">{t.t('cns.noticeTextHint', { min: String(NOTICE_MIN_CHARS) })}</p>
            <button type="submit" className="kv-btn">{t.t('cns.saveNotice')}</button>
          </form>

          <h3>{t.t('cns.publishHeading')}</h3>
          {block === null ? (
            <form action={publishConsentVersionAction} className="kv-card kv-action-card">
              <input type="hidden" name="code" value={p.code} />
              <input type="hidden" name="versionId" value={draft.id} />
              <p className="kv-field__hint">{t.t('cns.publishHint')}</p>
              <label className="kv-field__label" htmlFor="checkerNote">{t.t('cns.checkerNote')}</label>
              <input id="checkerNote" name="checkerNote" className="kv-input" maxLength={1000} />
              <p className="kv-field__hint">{t.t('cns.checkerNoteOptional')}</p>
              <button type="submit" className="kv-btn">{t.t('cns.publish', { v: draft.version })}</button>
            </form>
          ) : (
            /* THE CONTROL IS ABSENT, with the reason named. Each of the three reasons needs a different next action. */
            <p className="kv-notice">{t.t(`cns.publishBlocked.${block}`)}</p>
          )}

          <form action={discardConsentDraftAction} className="kv-card kv-action-card">
            <input type="hidden" name="code" value={p.code} />
            <input type="hidden" name="versionId" value={draft.id} />
            <p className="kv-field__hint">{t.t('cns.discardHint')}</p>
            <label className="kv-field__label" htmlFor="discardReason">{t.t('cns.reason')}</label>
            <input id="discardReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
            <button type="submit" className="kv-btn kv-btn--danger">{t.t('cns.discard')}</button>
          </form>
        </>
      ) : (
        <>
          <h2>{t.t('cns.openDraftHeading')}</h2>
          <form action={openConsentDraftAction} className="kv-card kv-action-card">
            <input type="hidden" name="code" value={p.code} />
            <p className="kv-field__hint">{t.t('cns.openDraftHint')}</p>
            <label className="kv-field__label" htmlFor="changeReason">{t.t('cns.changeReason')}</label>
            <input id="changeReason" name="changeReason" className="kv-input" required minLength={3} maxLength={1000} />
            <label className="kv-check">
              <input type="checkbox" name="isMandatory" value="true" defaultChecked={p.isMandatory} /> {t.t('cns.makeMandatory')}
            </label>
            {/* Changing whether a purpose is compulsory is a VERSION-level decision: somebody who agreed while it was
                mandatory did not give it freely, and flipping a live flag would silently re-describe their consent. */}
            <p className="kv-field__hint">{t.t('cns.mandatoryIsVersioned')}</p>
            <button type="submit" className="kv-btn">{t.t('cns.openDraft')}</button>
          </form>
        </>
      )}

      {!p.ivrEvidence.available && <p className="kv-detail__muted">{t.t('cns.ivrGap')}</p>}
    </section>
  );
}
