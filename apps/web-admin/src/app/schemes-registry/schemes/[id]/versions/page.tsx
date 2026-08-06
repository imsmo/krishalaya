// apps/web-admin/src/app/schemes-registry/schemes/[id]/versions/page.tsx · W070's version history + the draft editor
// (PC-56 ADMIN-4, migration 0105).
//
// The canon panel shows "v6 · Kharif 2026 window + premium table update · 4,206 applications filed on v6 · checker:
// Amit R." — a signed, countable rule set. Before this wave a version was an integer on a mutable row, so none of
// that could be rendered truthfully. Three things this page does that a naive version list would not:
//   • `coverage.unrecorded` — a scheme at v6 whose earliest RECORDED version is v6 changed five times before 0105 and
//     those rule sets are gone. The panel says so, instead of "no earlier versions".
//   • a backfilled version gets NO signature line, because nobody signed it (ck_scheme_version_backfill).
//   • the Publish control is ABSENT, not disabled, when the viewer drafted the change (maker-checker by absence).
// Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin, adminUserId } from '../../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../../lib/admin-client';
import { getTranslator } from '../../../../../lib/i18n';
import { adminNoticeKey } from '../../../../../features/nav/nav-model';
import type { SchemeRow } from '../../../../../features/schemes-registry/scheme';
import {
  VersionRow, Coverage, versionKind, versionClass, showsSignature, coverageNote,
  projectionDiverged, openDraft, publishBlockedReason, feeText,
} from '../../../../../features/schemes-registry/version';
import { saveDraftAction, discardDraftAction } from '../../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sv.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['drafted', 'published', 'discarded']);
const ERR = new Set([
  'benefitSummary', 'eligibilityRules', 'requiredDocTypeIds', 'applicableRegionIds', 'window',
  'processingFeeMinor', 'reason', 'empty', 'selfPublish', 'notDraft', 'draftOpen', 'noPublished',
  'checkerNote', 'elevation', 'conflict', 'invalid', 'notFound', 'generic',
]);

export default async function SchemeVersionsPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const id = params.id;

  let scheme: SchemeRow | undefined; let notice: string | undefined;
  try { scheme = (await adminGet<SchemeRow>(`schemes-registry/schemes/${encodeURIComponent(id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let rows: VersionRow[] = [];
  let coverage: Coverage = { earliestRecorded: null, unrecordedBelow: null };
  let liveVersion = scheme?.version ?? 0;
  let versionsNotice: string | undefined;
  try {
    const res = await adminGet<VersionRow[]>(`schemes-registry/schemes/${encodeURIComponent(id)}/versions`, { limit: 50 });
    rows = res.data ?? [];
    const meta = res.meta as { coverage?: Coverage; liveVersion?: number } | undefined;
    if (meta?.coverage) coverage = meta.coverage;
    if (typeof meta?.liveVersion === 'number') liveVersion = meta.liveVersion;
  } catch (e) {
    // Independent degrade: the scheme facts above are still worth showing.
    versionsNotice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  if (!scheme) {
    return <section><p className="kv-backlink"><Link href="/schemes-registry/schemes">{t.t('sr.backSchemes')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const draft = openDraft(rows);
  const current = rows.find((r) => r.status === 'published') ?? null;
  const note = coverageNote(coverage);
  const diverged = projectionDiverged(liveVersion, rows);
  // DISPLAY GATING ONLY — `adminUserId` reads the UNVERIFIED `sub` claim (see lib/admin-auth). The authority is the
  // CHECK constraint plus admin-api's 409. Null means "cannot tell", and the safe direction there is to SHOW the
  // control and let the server refuse: a redundant refusal is recoverable, a wrongly hidden control blocks work.
  const viewerId = adminUserId();
  const block = publishBlockedReason(draft, viewerId);
  const win = scheme.applicationWindow;

  return (
    <section>
      <p className="kv-backlink"><Link href={`/schemes-registry/schemes/${encodeURIComponent(id)}`}>{t.t('sv.backScheme')}</Link></p>
      <h1>{scheme.code} — {t.t('sv.heading')}</h1>
      <p className="kv-muted">{t.t('sv.lead')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`sv.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`sv.error.${errKey}`)}</p>}
      {versionsNotice && <p className="kv-error" role="alert">{versionsNotice}</p>}

      {/* Should be impossible. Reported rather than reconciled: the live row is what apps/api serves farmers, so if
          the two disagree an operator needs to know which number is reaching people. */}
      {diverged && <p className="kv-error" role="alert">{t.t('sv.diverged', { live: String(liveVersion), published: String(current?.version ?? 0) })}</p>}

      {/* The honest coverage note. `unrecorded` is the case the canon's mock cannot show and every real scheme has. */}
      {note === 'unrecorded' && <p className="kv-notice">{t.t('sv.coverage.unrecorded', { below: String(coverage.unrecordedBelow ?? 0) })}</p>}
      {note === 'none' && <p className="kv-notice">{t.t('sv.coverage.none')}</p>}

      <h2>{t.t('sv.historyHeading')}</h2>
      {rows.length === 0 && !versionsNotice && <p className="kv-empty">{t.t('sv.noVersions')}</p>}
      <ul className="kv-timeline">
        {rows.map((v) => {
          const kind = versionKind(v);
          return (
            <li key={v.id} className="kv-timeline__item">
              <p className="kv-timeline__head">
                <Link href={`/schemes-registry/schemes/${encodeURIComponent(id)}/versions/${encodeURIComponent(v.id)}`}>v{v.version}</Link>{' '}
                <span className={versionClass(kind)}>{t.t(`sv.kind.${kind}`)}</span>
              </p>
              <p>{v.changeReason}</p>
              <p className="kv-detail__muted">
                {/* The count the canon prints beside each version. A resolved-pointer count, so a legacy application
                    whose version cannot be resolved is not miscredited to whichever version shares its number. */}
                {t.t('sv.filedUnder', { n: String(v.applicationCount ?? 0) })} · {t.t('sv.fee')}: {feeText(v.processingFeeMinor)}
              </p>
              {showsSignature(v)
                ? <p className="kv-detail__muted">{t.t('sv.signedBy', { who: v.publishedBy ?? '', when: v.publishedAt ?? '' })}{v.checkerNote ? ` — ${v.checkerNote}` : ''}</p>
                /* No signature line at all for a backfilled row: there is no publisher to name, and a blank name
                   reads as a rendering fault rather than as "nobody signed this". */
                : <p className="kv-detail__muted">{t.t(`sv.unsigned.${kind === 'backfilled' ? 'backfilled' : 'draft'}`)}</p>}
            </li>
          );
        })}
      </ul>

      {draft && (
        <>
          <h2>{t.t('sv.draftHeading', { v: String(draft.version) })}</h2>
          {/* MAKER-CHECKER BY ABSENCE. When the viewer drafted this change there is no Publish form here at all —
              only the line naming the rule. A disabled button teaches people to ask for a permission they hold. */}
          {block === 'sameActor'
            ? <p className="kv-notice">{t.t('sv.publishBlocked.sameActor')}</p>
            : <p className="kv-muted">{t.t('sv.publishElsewhere')} <Link href={`/schemes-registry/schemes/${encodeURIComponent(id)}/versions/${encodeURIComponent(draft.id)}`}>{t.t('sv.openReview')}</Link></p>}
          <form action={discardDraftAction} className="kv-card kv-action-card">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="versionId" value={draft.id} />
            <p className="kv-field__hint">{t.t('sv.discardHint')}</p>
            <label className="kv-field__label" htmlFor="discardReason">{t.t('sr.reason')}</label>
            <input id="discardReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
            <button type="submit" className="kv-btn kv-btn--danger">{t.t('sv.discard')}</button>
          </form>
        </>
      )}

      <h2>{draft ? t.t('sv.editDraftHeading') : t.t('sv.openDraftHeading')}</h2>
      <p className="kv-notice">{t.t('sv.draftNothingLive')}</p>
      <form action={saveDraftAction} className="kv-card kv-action-card">
        <input type="hidden" name="id" value={id} />
        <p className="kv-field__hint">{t.t('sv.blankMeansUnchanged')}</p>

        <label className="kv-field__label" htmlFor="benefitSummary">{t.t('sr.benefitSummary')}</label>
        <input id="benefitSummary" name="benefitSummary" className="kv-input" defaultValue="" placeholder={t.t('sr.jsonHint')} />
        <label className="kv-field__label" htmlFor="eligibilityRules">{t.t('sr.eligibilityRules')}</label>
        <input id="eligibilityRules" name="eligibilityRules" className="kv-input" defaultValue="" placeholder={t.t('sr.jsonHint')} />
        <label className="kv-field__label" htmlFor="requiredDocTypeIds">{t.t('sr.requiredDocTypeIds')}</label>
        <input id="requiredDocTypeIds" name="requiredDocTypeIds" className="kv-input" placeholder={t.t('sr.uuidListHint')} />
        <label className="kv-field__label" htmlFor="applicableRegionIds">{t.t('sr.applicableRegionIds')}</label>
        <input id="applicableRegionIds" name="applicableRegionIds" className="kv-input" placeholder={t.t('sr.uuidListHint')} />

        <fieldset className="kv-fieldset">
          <legend>{t.t('sv.windowLegend')}</legend>
          {/* THE WINDOW IS VERSIONED NOW — W073's own locked state says window dates come from scheme versions. */}
          <p className="kv-field__hint">{t.t('sv.windowVersionedHint')}</p>
          <label className="kv-field__label" htmlFor="window_opens">{t.t('sr.windowOpens')}</label>
          <input id="window_opens" name="window_opens" className="kv-input" defaultValue={win?.opens ?? ''} placeholder={t.t('sr.mmddHint')} />
          <label className="kv-field__label" htmlFor="window_closes">{t.t('sr.windowCloses')}</label>
          <input id="window_closes" name="window_closes" className="kv-input" defaultValue={win?.closes ?? ''} placeholder={t.t('sr.mmddHint')} />
          <label className="kv-field__label" htmlFor="window_season">{t.t('sr.season')}</label>
          <input id="window_season" name="window_season" className="kv-input" defaultValue={win?.season ?? ''} placeholder={t.t('sr.seasonHint')} />
          {/* Its own control, because two blank date boxes cannot say the difference between "leave the window alone"
              and "make this scheme always-open", and guessing would silently unseason a seasonal scheme. */}
          <label className="kv-check"><input type="checkbox" name="window_clear" value="true" /> {t.t('sv.windowClear')}</label>
        </fieldset>

        <label className="kv-field__label" htmlFor="processingFeeMinor">{t.t('sr.feeMinor')}</label>
        <input id="processingFeeMinor" name="processingFeeMinor" className="kv-input" inputMode="numeric" placeholder={scheme.processingFeeMinor} />
        <label className="kv-field__label" htmlFor="draftReason">{t.t('sr.reason')}</label>
        <input id="draftReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
        <button type="submit" className="kv-btn">{draft ? t.t('sv.saveDraft') : t.t('sv.openDraft')}</button>
      </form>
    </section>
  );
}
