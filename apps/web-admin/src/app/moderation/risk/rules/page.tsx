// apps/web-admin/src/app/moderation/risk/rules/page.tsx · W095, the risk-weight editor (PC-56 ADMIN-5d).
//
// W095's sentence is the design: "Every change is dry-run against yesterday's population before it can ship." The
// Approve control is ABSENT — not disabled — until a proposal exists, carries a dry run, that dry run is fresh, and
// the viewer is not the proposer. Each of those four has its own message, because the operator's next move differs:
// run one, re-run it, nothing, or find a colleague.
//
// AND THE SCREEN'S REAL WORK IS THE DRIFT PANEL. Verifying this table against the code that scores people found that
// of the five seeded rules, exactly one has a producer and it fires −15 where the rule says −12; three have no
// producer anywhere on the platform; and the event that fires most often is not in the table at all. The band ladder
// in code is ten points harsher than the canon's at every boundary. None of that was corrected by this wave —
// correcting it moves people between bands, which is precisely the change W095 says needs a dry run first — so the
// screen shows it. On a table the platform does not obey, the drift is not a footnote; it is the state of the system.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin, adminUserId } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { approveWeightAction, proposeWeightAction, withdrawProposalAction } from '../../actions';
import { Button, StatusPill } from '@krishalaya/ui';
import {
  approveBlockedKey, firedText, driftTone, dryRunState, type RuleRow, type DriftItem,
} from '../../../../features/trust/trust-safety';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ts.rules.title'), robots: { index: false, follow: false } };
}

interface Board {
  windowDays: number;
  producerSource: string;
  dryRunMaxAgeHours: number;
  rules: RuleRow[];
  drift: DriftItem[];
  coverage: { total: number; fired: number; neverFired: string[]; countsUnavailable: boolean };
  ladderDrift: { band: string; canonFloor: number; codeFloor: number }[];
}

const OK = new Set(['proposed', 'approved', 'withdrawn']);
const ERR = new Set(['weight', 'sameWeight', 'reason', 'dryRun', 'dryRunArithmetic', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function RiskRulesPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const viewer = adminUserId();

  let b: Board | undefined; let notice: string | undefined;
  try { b = (await adminGet<Board>('trust/risk/rules')).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  if (!b) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/moderation">{t.t('ts.backOverview')}</Link></p>
        <h1>{t.t('ts.rules.heading')}</h1>
        <p className="kv-error" role="alert">{notice}</p>
      </section>
    );
  }

  return (
    <section>
      <p className="kv-backlink"><Link href="/moderation">{t.t('ts.backOverview')}</Link></p>
      <h1>{t.t('ts.rules.heading')}</h1>
      <p className="kv-muted">{t.t('ts.rules.lead', { h: String(b.dryRunMaxAgeHours) })}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`ts.rules.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`ts.error.${errKey}`)}</p>}

      {/* ============ THE DRIFT, FIRST, BECAUSE IT GOVERNS HOW TO READ EVERYTHING BELOW ============ */}
      <h2>{t.t('ts.rules.driftHeading')}</h2>
      {b.drift.length === 0 ? (
        <p className="kv-success" role="status">{t.t('ts.rules.noDrift')}</p>
      ) : (
        <>
          <p className="kv-error" role="alert">{t.t('ts.rules.driftLead', { source: b.producerSource })}</p>
          <table className="kv-table">
            <thead><tr>
              <th>{t.t('ts.rules.col.event')}</th><th>{t.t('ts.rules.col.driftKind')}</th>
              <th>{t.t('ts.rules.col.configured')}</th><th>{t.t('ts.rules.col.observed')}</th>
            </tr></thead>
            <tbody>
              {b.drift.map((d) => (
                <tr key={`${d.kind}-${d.eventCode}`}>
                  <td>{d.eventCode}</td>
                  <td><StatusPill tone={driftTone(d.kind)} label={t.t(`ts.rules.drift.${d.kind}`)} /></td>
                  <td>{d.configured === null ? t.t('common.dash') : String(d.configured)}</td>
                  <td>{d.observed === null ? t.t('common.dash') : String(d.observed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {b.ladderDrift.length > 0 && (
        <>
          <h2>{t.t('ts.rules.ladderHeading')}</h2>
          <p className="kv-error" role="alert">{t.t('ts.rules.ladderLead')}</p>
          <table className="kv-table">
            <thead><tr><th>{t.t('ts.rules.col.band')}</th><th>{t.t('ts.rules.col.canonFloor')}</th><th>{t.t('ts.rules.col.codeFloor')}</th></tr></thead>
            <tbody>
              {b.ladderDrift.map((l) => (
                <tr key={l.band}><td>{t.t(`ts.band.${l.band}`)}</td><td>{l.canonFloor}</td><td>{l.codeFloor}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ============ THE WEIGHTS ============ */}
      <h2>{t.t('ts.rules.weightsHeading')}</h2>
      <p className="kv-detail__muted">
        {b.coverage.countsUnavailable
          // "we could not count" must never be shown as "these rules have never fired".
          ? t.t('ts.rules.coverageUnknown')
          : t.t('ts.rules.coverage', { fired: String(b.coverage.fired), total: String(b.coverage.total), days: String(b.windowDays) })}
      </p>
      <table className="kv-table">
        <thead><tr>
          <th>{t.t('ts.rules.col.event')}</th><th>{t.t('ts.rules.col.weight')}</th>
          <th>{t.t('ts.rules.col.fired', { days: String(b.windowDays) })}</th>
          <th>{t.t('ts.rules.col.notes')}</th><th>{t.t('ts.rules.col.proposal')}</th>
        </tr></thead>
        <tbody>
          {b.rules.map((r) => {
            const fired = firedText(r.firedCount);
            const blocked = approveBlockedKey(r.proposal, viewer);
            const dr = dryRunState(r.proposal?.dryRun);
            return (
              <tr key={r.eventCode}>
                <td>{r.eventCode}</td>
                <td>{r.weight}</td>
                {/* A failed count renders as a dash, never 0 — for three of these rules 0 is the true answer, which
                    is exactly why an unreadable count must not look like one. */}
                <td>{fired.known ? fired.text : <span className="kv-detail__muted">{t.t('ts.rules.firedUnknown')}</span>}</td>
                <td>{r.notes ?? t.t('common.dash')}</td>
                <td>
                  {!r.proposal ? t.t('common.dash') : (
                    <>
                      <div>{t.t('ts.rules.proposedTo', { from: String(r.weight), to: String(r.proposal.weight) })}</div>
                      {dr === 'absent' && <StatusPill tone="danger" label={t.t('ts.rules.dryRun.absent')} />}
                      {dr === 'stale' && <StatusPill tone="warning" label={t.t('ts.rules.dryRun.stale')} />}
                      {dr === 'fresh' && r.proposal.dryRun && (
                        <div className="kv-detail__muted">
                          {t.t('ts.rules.dryRun.figures', {
                            drops: String(r.proposal.dryRun.bandDrops ?? 0),
                            restricted: String(r.proposal.dryRun.newRestricted ?? 0),
                            population: String(r.proposal.dryRun.population ?? 0),
                          })}
                        </div>
                      )}
                      {r.proposal.checkedBy && <StatusPill tone="success" label={t.t('ts.rules.approvedBy', { who: r.proposal.checkedBy })} />}

                      {/* MAKER-CHECKER BY ABSENCE. The control is not drawn; the reason is named beside it. */}
                      {r.proposal.approveOfferable && blocked === null ? (
                        <form action={approveWeightAction}>
                          <input type="hidden" name="code" value={r.eventCode} />
                          <label className="kv-field__label">
                            {t.t('ts.rules.approveNote')}
                            <input className="kv-input" name="note" required minLength={1} maxLength={1000} />
                          </label>
                          <Button type="submit" variant="danger">{t.t('ts.rules.approve')}</Button>
                        </form>
                      ) : (
                        blocked && <div className="kv-detail__muted">{t.t(`ts.rules.approveBlocked.${blocked}`)}</div>
                      )}

                      {!r.proposal.checkedBy && (
                        <form action={withdrawProposalAction}>
                          <input type="hidden" name="code" value={r.eventCode} />
                          <label className="kv-field__label">
                            {t.t('ts.rules.withdrawReason')}
                            <input className="kv-input" name="reason" required minLength={1} maxLength={1000} />
                          </label>
                          <Button type="submit">{t.t('ts.rules.withdraw')}</Button>
                        </form>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ============ PROPOSE ============ */}
      <h2>{t.t('ts.rules.proposeHeading')}</h2>
      <p className="kv-muted">{t.t('ts.rules.proposeLead')}</p>
      <form action={proposeWeightAction} className="kv-form">
        <label className="kv-field__label">
          {t.t('ts.rules.col.event')}
          <select className="kv-input" name="code" required defaultValue="">
            <option value="" disabled>{t.t('common.choose')}</option>
            {b.rules.filter((r) => r.isActive).map((r) => <option key={r.eventCode} value={r.eventCode}>{r.eventCode} ({r.weight})</option>)}
          </select>
        </label>
        <label className="kv-field__label">{t.t('ts.rules.newWeight')}<input className="kv-input" name="proposedWeight" required inputMode="numeric" /></label>
        <label className="kv-field__label">{t.t('ts.rules.changeReason')}<textarea className="kv-input" name="changeReason" required minLength={10} maxLength={1000} /></label>

        <fieldset className="kv-fieldset">
          {/* THE DRY RUN IS PART OF THE FORM, NOT A SEPARATE STEP SOMEBODY CAN SKIP. Both the console and the server
              refuse a proposal without one, and the database refuses an approval without one (0110). */}
          <legend>{t.t('ts.rules.dryRunHeading')}</legend>
          <p className="kv-detail__muted">{t.t('ts.rules.dryRunLead', { h: String(b.dryRunMaxAgeHours) })}</p>
          <label className="kv-field__label">{t.t('ts.rules.bandDrops')}<input className="kv-input" name="bandDrops" required inputMode="numeric" /></label>
          <label className="kv-field__label">{t.t('ts.rules.newRestricted')}<input className="kv-input" name="newRestricted" required inputMode="numeric" /></label>
          <label className="kv-field__label">{t.t('ts.rules.population')}<input className="kv-input" name="population" required inputMode="numeric" /></label>
          <label className="kv-field__label">{t.t('ts.rules.computedAt')}<input className="kv-input" name="computedAt" type="datetime-local" required /></label>
        </fieldset>

        <Button type="submit">{t.t('ts.rules.propose')}</Button>
      </form>
      <p className="kv-detail__muted">{t.t('ts.rules.noThresholdEditor')}</p>
    </section>
  );
}
