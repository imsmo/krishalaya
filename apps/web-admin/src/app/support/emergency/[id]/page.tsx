// apps/web-admin/src/app/support/emergency/[id]/page.tsx · one safety case (PC-56 ADMIN-SWEEP-b3;
// W2151–W2153 as real states of this page).
//
// METADATA ONLY, BY CONSTRUCTION: nothing in the admin realm reads a message body, so W058's "even platform owner
// sees case metadata only, not thread content" is a fact this page inherits rather than a promise it makes. The
// step forms are the W2151 confirm (each states what recording does — and for page_vet, what it does NOT do);
// ?ok/?error are the W2152/W2153 states.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { joinCaseAction, recordStepAction } from '../../actions';
import { categoryTone, stepTone, stepNeedsDetail, STEP_DETAIL_MIN } from '../../../../features/support/emergency';

import { Button, EmptyState, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('em.caseTitle'), robots: { index: false, follow: false } };
}

interface Step { id: string; stepCode: string; status: string; detail: string; actorAdminId: string; vetProfileId: string | null; createdAt: string }
interface Vet { id: string; fullName: string | null; phone: string | null; languageCode: string | null; registrationNo: string; serviceRadiusKm: number; ratingAvg: string | null; region: string | null; sameRegion: boolean }
interface CaseView {
  id: string; tenantId: string; ticketNo: string; categoryCode: string; channel: string; status: string;
  subject: string | null; age: string; tenantDistrict: string | null;
  requester: { userId: string | null; name: string | null; phone: string | null; languageCode: string | null; gender: string | null } | null;
  steps: Step[]; responders: { adminId: string; joinedAt: string }[]; joined: boolean;
  protocol: { code: string; kind: string }[]; vets: Vet[];
}

const OK = new Set(['joined', 'alreadyJoined', 'stepRecorded', 'stepPending']);
const ERR = new Set(['step', 'detail', 'elevation', 'illegal', 'invalid', 'notFound', 'generic']);

export default async function SafetyCasePage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let c: CaseView | undefined; let notice: string | undefined;
  try { c = (await adminGet<CaseView>(`support/emergency/cases/${encodeURIComponent(params.id)}`)).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  if (!c) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/support/emergency">{t.t('em.backDesk')}</Link></p>
        <h1>{t.t('em.caseHeading')}</h1>
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  return (
    <section>
      <p className="kv-backlink"><Link href="/support/emergency">{t.t('em.backDesk')}</Link></p>
      <h1>{c.ticketNo} <StatusPill tone={categoryTone(c.categoryCode)} label={t.t(`em.cat.${c.categoryCode}`)} /></h1>
      {okKey && <p className="kv-success" role="status">{t.t(`em.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`em.error.${errKey}`)} {t.t('em.nothingChanged')}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('em.col.age')}</dt><dd>{c.age} · {c.status}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('em.col.channel')}</dt><dd>{c.channel}{c.channel !== 'app' ? t.t('hub.declaredMark') : ''}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('em.col.district')}</dt><dd>{c.tenantDistrict ?? t.t('common.dash')} <span className="kv-detail__muted">{t.t('em.districtNote')}</span></dd></div>
        {c.requester && (
          <div className="kv-facts__row">
            <dt>{t.t('em.requester')}</dt>
            <dd>{c.requester.name ?? t.t('common.dash')} · {c.requester.phone ?? t.t('common.dash')} · {c.requester.languageCode}
              {/* surfaced because women_safety's protocol is "female agent preferred" — a routing fact */}
              {c.categoryCode === 'women_safety' && c.requester.gender && <span className="kv-detail__muted"> · {c.requester.gender}</span>}
            </dd>
          </div>
        )}
        <div className="kv-facts__row"><dt>{t.t('em.subject')}</dt><dd>{c.subject ?? t.t('common.dash')}</dd></div>
      </dl>
      <p className="kv-detail__muted">{t.t('em.threadHonesty')}</p>

      {/* ---- responders ---- */}
      <h2>{t.t('em.respondersHeading')}</h2>
      <ul className="kv-list">
        {c.responders.map((r) => <li key={r.adminId}>{r.adminId} · {r.joinedAt}</li>)}
      </ul>
      {c.responders.length === 0 && <EmptyState title={t.t('em.noResponders')} />}
      {!c.joined && (
        <form action={joinCaseAction}>
          <input type="hidden" name="id" value={c.id} />
          <Button type="submit">{t.t('em.join')}</Button>
        </form>
      )}

      {/* ---- the step register ---- */}
      <h2>{t.t('em.stepsHeading')}</h2>
      <ul className="kv-list">
        {c.steps.map((s) => (
          <li key={s.id}>
            <StatusPill tone={stepTone(s.status)} label={`${t.t(`em.step.${s.stepCode}` as never)}${s.status === 'provider_pending' ? t.t('em.pendingMark') : ''}`} />{' '}
            {s.detail} <span className="kv-detail__muted">— {s.actorAdminId} · {s.createdAt}</span>
          </li>
        ))}
      </ul>
      {c.steps.length === 0 && <EmptyState title={t.t('em.noSteps')} />}

      {c.joined ? (
        <>
          <h3>{t.t('em.recordHeading')}</h3>
          {c.protocol.map((p) => (
            <form key={p.code} action={recordStepAction} className="kv-form">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="stepCode" value={p.code} />
              <input type="hidden" name="kind" value={p.kind} />
              <p className="kv-field__label">
                {t.t(`em.step.${p.code}` as never)}
                {/* W2151's confirm sentence, per step: page_vet states what it will NOT do. */}
                {p.kind === 'would_page' && <span className="kv-detail__muted"> — {t.t('em.pageVetTruth')}</span>}
              </p>
              {stepNeedsDetail(p.kind) && (
                <textarea name="detail" className="kv-input" required minLength={STEP_DETAIL_MIN} maxLength={2000}
                  placeholder={t.t('em.detailPlaceholder')} />
              )}
              {c.categoryCode === 'emergency_vet' && p.code === 'vet_contacted' && (
                <input name="vetProfileId" className="kv-input" placeholder={t.t('em.vetIdPlaceholder')} />
              )}
              <Button type="submit">{t.t('em.record')}</Button>
            </form>
          ))}
        </>
      ) : (
        <p className="kv-detail__muted">{t.t('em.joinFirst')}</p>
      )}

      {/* ---- emergency vets (their own published offer) ---- */}
      {c.categoryCode === 'emergency_vet' && (
        <>
          <h2>{t.t('em.vetsHeading')}</h2>
          <p className="kv-muted">{t.t('em.vetsLead')}</p>
          <table className="kv-table">
            <thead><tr><th>{t.t('em.vet.name')}</th><th>{t.t('em.vet.phone')}</th><th>{t.t('em.vet.region')}</th><th>{t.t('em.vet.radius')}</th><th>{t.t('em.vet.reg')}</th></tr></thead>
            <tbody>
              {c.vets.map((v) => (
                <tr key={v.id}>
                  <td>{v.fullName ?? t.t('common.dash')}{v.sameRegion && <StatusPill tone="success" label={t.t('em.vet.sameRegion')} />}</td>
                  <td>{v.phone}</td>
                  <td>{v.region ?? t.t('common.dash')}</td>
                  <td>{v.serviceRadiusKm} km</td>
                  <td>{v.registrationNo}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.vets.length === 0 && <EmptyState title={t.t('em.noVets')} />}
          <p className="kv-detail__muted">{t.t('em.vetsHonesty')}</p>
        </>
      )}
    </section>
  );
}
