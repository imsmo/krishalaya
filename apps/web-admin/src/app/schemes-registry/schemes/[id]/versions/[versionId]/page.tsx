// apps/web-admin/src/app/schemes-registry/schemes/[id]/versions/[versionId]/page.tsx · W2254, the review step
// (PC-56 ADMIN-4).
//
// "Maker-checker friendly review step: everything you entered, shown read-only, with the diff against current values
// where applicable" — and this is the ONE screen in the wave where the ordering of the content is itself a control.
// The diff is sorted so the fields that change what a farmer pays or qualifies for come FIRST (`orderedDiff`): a
// checker reads top-down, and a region-list reshuffle sitting above a fee change is how a fee change gets approved
// without being seen.
//
// The Publish form is ABSENT when the viewer drafted this version. Not disabled — absent, with the rule named beside
// it. The server refuses either way (`assertPublishable`, plus `ck_scheme_version_maker_ne_checker` at the database);
// this is about what the screen tells an operator is possible.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin, adminUserId } from '../../../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../../../lib/admin-client';
import { getTranslator } from '../../../../../../lib/i18n';
import { adminNoticeKey } from '../../../../../../features/nav/nav-model';
import {
  VersionRow, DiffEntry, versionKind, versionClass, showsSignature, orderedDiff, isAddition, feeChanged, feeText,
} from '../../../../../../features/schemes-registry/version';
import { publishVersionAction, discardDraftAction } from '../../../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sv.reviewTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['drafted']);
const ERR = new Set(['selfPublish', 'notDraft', 'checkerNote', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

interface VersionDetail extends VersionRow { comparedWith: number | null; diff: DiffEntry[] }

export default async function VersionReviewPage({ params, searchParams }: { params: { id: string; versionId: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const { id, versionId } = params;

  let v: VersionDetail | undefined; let notice: string | undefined;
  try { v = (await adminGet<VersionDetail>(`schemes-registry/schemes/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  if (!v) {
    return <section><p className="kv-backlink"><Link href={`/schemes-registry/schemes/${encodeURIComponent(id)}/versions`}>{t.t('sv.backVersions')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const kind = versionKind(v);
  const diff = orderedDiff(v.diff ?? []);
  // DISPLAY GATING ONLY — `adminUserId` reads the UNVERIFIED `sub` claim (see lib/admin-auth). The authority is the
  // CHECK constraint plus admin-api's 409. Null means "cannot tell", and the safe direction there is to SHOW the
  // control and let the server refuse: a redundant refusal is recoverable, a wrongly hidden control blocks work.
  const viewerId = adminUserId();
  const isOwnDraft = Boolean(v.draftedBy && viewerId && v.draftedBy === viewerId);
  const canPublish = v.status === 'draft' && !isOwnDraft;

  return (
    <section>
      <p className="kv-backlink"><Link href={`/schemes-registry/schemes/${encodeURIComponent(id)}/versions`}>{t.t('sv.backVersions')}</Link></p>
      <h1>v{v.version} <span className={versionClass(kind)}>{t.t(`sv.kind.${kind}`)}</span></h1>
      {okKey && <p className="kv-success" role="status">{t.t(`sv.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`sv.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('sv.changeReason')}</dt><dd>{v.changeReason}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sv.fee')}</dt><dd>{feeText(v.processingFeeMinor)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('sv.filedUnderLabel')}</dt><dd>{String(v.applicationCount ?? 0)}</dd></div>
        {showsSignature(v) && <div className="kv-facts__row"><dt>{t.t('sv.checker')}</dt><dd>{v.publishedBy} · {v.publishedAt}{v.checkerNote ? ` — ${v.checkerNote}` : ''}</dd></div>}
      </dl>

      <h2>{t.t('sv.diffHeading', { against: v.comparedWith === null ? t.t('sv.nothing') : `v${v.comparedWith}` })}</h2>
      {/* A fee change gets its own line above the table. It is the field an approver is most likely to skim past and
          the only one that takes money out of a farmer's wallet. */}
      {feeChanged(diff) && <p className="kv-notice">{t.t('sv.feeChanged')}</p>}
      {diff.length === 0
        ? <p className="kv-empty">{t.t('sv.noDiff')}</p>
        : (
          <table className="kv-table kv-diff">
            <thead><tr><th>{t.t('sv.field')}</th><th>{t.t('sv.from')}</th><th>{t.t('sv.to')}</th></tr></thead>
            <tbody>
              {diff.map((d) => (
                <tr key={d.field}>
                  <th scope="row">{t.t(`sv.field.${d.field}`)}</th>
                  {/* An addition is LABELLED rather than shown as an empty cell — a blank "from" reads as data that
                      failed to load, and a checker who thinks the screen is broken approves anyway. */}
                  <td>{isAddition(d) ? <span className="kv-detail__muted">{t.t('sv.wasAbsent')}</span> : <pre className="kv-pre">{d.from}</pre>}</td>
                  <td><pre className="kv-pre">{d.to}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      {v.status === 'draft' && (
        <>
          <h2>{t.t('sv.decideHeading')}</h2>
          {/* THE CONTROL IS NOT HERE when this is the viewer's own draft. */}
          {canPublish ? (
            <form action={publishVersionAction} className="kv-card kv-action-card">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="versionId" value={v.id} />
              <p className="kv-field__hint">{t.t('sv.publishHint')}</p>
              <label className="kv-field__label" htmlFor="checkerNote">{t.t('sv.checkerNote')}</label>
              {/* OPTIONAL. A checker who agrees has nothing to add, and a mandatory note produces 'ok'. */}
              <input id="checkerNote" name="checkerNote" className="kv-input" maxLength={1000} />
              <p className="kv-field__hint">{t.t('sv.checkerNoteOptional')}</p>
              <button type="submit" className="kv-btn">{t.t('sv.publish', { v: String(v.version) })}</button>
            </form>
          ) : (
            <p className="kv-notice">{t.t('sv.publishBlocked.sameActor')}</p>
          )}

          <form action={discardDraftAction} className="kv-card kv-action-card">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="versionId" value={v.id} />
            {/* Discard IS offered to the maker: nothing a farmer can see has changed, and the person who wrote a bad
                draft is the likeliest to realise it. */}
            <p className="kv-field__hint">{t.t('sv.discardHint')}</p>
            <label className="kv-field__label" htmlFor="reviewDiscardReason">{t.t('sr.reason')}</label>
            <input id="reviewDiscardReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
            <button type="submit" className="kv-btn kv-btn--danger">{t.t('sv.discard')}</button>
          </form>
        </>
      )}

      {v.status !== 'draft' && <p className="kv-notice">{t.t('sv.immutable')}</p>}
    </section>
  );
}
