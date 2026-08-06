// apps/web-admin/src/app/support/escalation/page.tsx · the SUPPORT POLICY (PC-56 ADMIN-2b; canon W054 + W057).
//
// WHAT CHANGED HERE, AND WHY THE OLD VERSION OF THIS FILE WAS RIGHT TO SAY WHAT IT SAID. Until this wave, the page
// carried a warning in capital letters: nobody is paged automatically, because the platform stored no escalation chain.
// That was true, and stating it beat drawing an empty chain diagram somebody would read as "configured, just quiet".
//
// It is no longer true. Migration 0097 stores the policy — hours, routing, desk languages, AI limits, SLA targets and
// the chain — as versioned rows; 0098 records every step that fires; and apps/worker's support-escalations job fires
// them once a minute. So the warning is GONE, replaced by the thing it was standing in for. Leaving it would have been
// the worse failure of the two: a stale "nothing works" note teaches operators to disbelieve the console.
//
// THREE THINGS THIS PAGE REFUSES TO BLUR:
//   1. THE CHAIN AND ITS DELIVERY ARE DIFFERENT FACTS. The policy can say "ring the support head" while nothing in the
//      platform can place a call. Every fired step therefore shows its real delivery status, and `provider_pending` is
//      never dressed up as sent.
//   2. A GAP IS NAMED ON THE ROW THAT HAS IT. A severity with a target and no chain step gets its own error line, not a
//      silent blank — that combination is exactly what this wave existed to remove and it can still be reached by a
//      version published before the validator existed.
//   3. NIGHT COVER IS STATED. "P0 in 15 minutes" reads like a 24-hour promise. If no step wakes anybody outside desk
//      hours, the page says so, because the alternative is a promise nobody has made.
//
// The publish form is pre-filled from the active version: publish-never-edit means editing IS publishing, and asking an
// operator to retype twelve fields to change one hour is how policies stop being maintained.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { publishSupportPolicyAction } from '../actions';
import {
  SEVERITIES, ROUTING_STRATEGIES, AI_MODES, ESCALATION_CHANNELS,
  humanMinutes, deskHours, chainFor, formSteps, matrixIsCoherent,
  severitiesWithoutChain, afterHoursContradictions, noNightCover, undeliveredEvents, wakesSomebody,
  type PolicyBundle,
} from '../../../features/support/policy';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('spol.title'), robots: { index: false, follow: false } };
}

const SEV_CLASS: Record<string, string> = { P0: 'kv-status--danger', P1: 'kv-status--danger', P2: 'kv-status--warn', P3: 'kv-status--muted' };
const EV_CLASS: Record<string, string> = {
  recorded: 'kv-status--ok', sent: 'kv-status--ok', provider_pending: 'kv-status--warn', failed: 'kv-status--danger',
};

/** The date input's default: tomorrow, because a policy effective yesterday is a policy nobody announced. */
function tomorrowIso(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

export default async function SupportPolicyPage(
  { searchParams }: { searchParams: { ok?: string; error?: string; at?: string; why?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  let bundle: PolicyBundle | null = null; let notice: string | undefined;
  try { bundle = (await adminGet<PolicyBundle>('support/policy')).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const policy = bundle?.policy ?? null;
  const slas = bundle?.slas ?? [];
  const chain = bundle?.escalations ?? [];
  const events = bundle?.recentEvents ?? [];
  const versions = bundle?.versions ?? [];

  const uncovered = severitiesWithoutChain(slas, chain);
  const contradictions = afterHoursContradictions(chain, policy?.afterHoursSeverities ?? []);
  const dark = policy ? noNightCover(chain, policy.afterHoursSeverities) : false;
  const undelivered = undeliveredEvents(events);
  const coherent = matrixIsCoherent(slas);
  const rows = formSteps(chain);

  const okKey = searchParams.ok === 'published' ? 'published' : undefined;
  const errKey = searchParams.error?.startsWith('pol_') ? searchParams.error.slice(4) : searchParams.error;

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p>
      <h1>{t.t('spol.title')}</h1>
      <p className="kv-muted">{t.t('spol.lead')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`spol.ok.${okKey}`)}</p>}
      {errKey && (
        <p className="kv-error" role="alert">
          {/* a 422 from the server carries the real reason; it is shown verbatim rather than paraphrased */}
          {errKey === 'rejected'
            ? t.t('spol.error.rejected', { why: searchParams.why ?? '' })
            : t.t(`spol.error.${errKey}`, { at: searchParams.at ?? '' })}
        </p>
      )}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : !policy ? (
        // Not an empty form: a platform with no published policy pages nobody, and that is worth a sentence.
        <p className="kv-error" role="alert">{t.t('spol.none')}</p>
      ) : (
        <>
          {/* ---------------- the active version ---------------- */}
          <dl className="kv-detail">
            <dt>{t.t('spol.activeVersion')}</dt>
            <dd>{t.t('spol.versionN', { n: String(policy.version) })} — {policy.name}</dd>
            <dt>{t.t('spol.effectiveFrom')}</dt><dd>{policy.effectiveFrom}</dd>
            <dt>{t.t('spol.hours')}</dt><dd>{deskHours(policy) ?? t.t('common.dash')}</dd>
            <dt>{t.t('spol.routing')}</dt><dd>{t.t(`spol.routing.${policy.routingStrategy}`)}</dd>
            <dt>{t.t('spol.languages')}</dt><dd>{policy.deskLanguages.join(', ') || t.t('common.dash')}</dd>
            <dt>{t.t('spol.aiMode')}</dt><dd>{t.t(`spol.ai.${policy.aiAssistMode}`)}</dd>
            <dt>{t.t('spol.aiExcluded')}</dt>
            <dd>{policy.aiExcludedSeverities.join(', ') || t.t('common.dash')}</dd>
            <dt>{t.t('spol.afterHours')}</dt>
            <dd>{policy.afterHoursSeverities.length
              ? policy.afterHoursSeverities.join(', ')
              : t.t('spol.afterHoursNone')}</dd>
          </dl>

          {/* A promise of minutes that only holds in office hours is worth saying out loud. */}
          {dark && <p className="kv-notice" role="note">{t.t('spol.nightGapWarn')}</p>}
          {contradictions.length > 0 && (
            <p className="kv-error" role="alert">
              {t.t('spol.nightContradiction', { n: String(contradictions.length) })}
            </p>
          )}

          {/* ---------------- the matrix, with its chain beside it ---------------- */}
          <h2>{t.t('esc.title')}</h2>
          {!coherent && <p className="kv-error" role="alert">{t.t('esc.incoherent')}</p>}
          {/* The same gap the rows below carry, said ONCE above the table. Not redundant: a role="alert" is announced to
              a screen reader and is visible without scanning four rows, whereas a status cell inside the table is
              neither. A severity with a target and nothing behind it is the whole reason this wave existed. */}
          {uncovered.length > 0 && (
            <p className="kv-error" role="alert">{uncovered.map((s) => t.t('spol.noChainFor', { sev: s })).join(' ')}</p>
          )}
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('esc.severity')}</th>
              <th scope="col">{t.t('esc.firstResponse')}</th>
              <th scope="col">{t.t('esc.resolution')}</th>
              <th scope="col">{t.t('spol.chainTitle')}</th>
            </tr></thead>
            <tbody>
              {slas.map((r) => {
                const steps = chainFor(chain, r.severity);
                return (
                  <tr key={r.severity}>
                    <td><span className={`kv-status ${SEV_CLASS[r.severity] ?? ''}`}>{r.severity}</span></td>
                    <td>{humanMinutes(r.firstResponseMinutes) ?? t.t('common.dash')}</td>
                    <td>{humanMinutes(r.resolutionMinutes) ?? t.t('common.dash')}</td>
                    <td>
                      {steps.length === 0
                        // the gap, named on the row that has it
                        ? <span className="kv-status kv-status--danger">{t.t('spol.noChainFor', { sev: r.severity })}</span>
                        : steps.map((s, i) => (
                          <span key={`${s.severity}-${s.afterMinutes}-${s.channel}-${i}`} className="kv-status">
                            {s.afterMinutes === 0 ? t.t('spol.atBreach') : t.t('spol.afterMin', { n: String(s.afterMinutes) })}
                            {' · '}{t.t(`spol.channel.${s.channel}`)}{' · '}{s.targetRole}
                          </span>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('esc.sourceNote')}</p>
          <p className="kv-field__hint">{t.t('esc.chainNote')}</p>

          {/* ---------------- what can actually be delivered ---------------- */}
          <h2>{t.t('spol.deliveryTitle')}</h2>
          <p className="kv-notice" role="note">{bundle?.deliveryNote || t.t('spol.deliveryNote')}</p>

          {/* ---------------- what the chain actually did ---------------- */}
          <h2>{t.t('spol.firedTitle')}</h2>
          <p className="kv-field__hint">{t.t('spol.firedHint')}</p>
          {undelivered.length > 0 && (
            <p className="kv-error" role="alert">{t.t('spol.undelivered', { n: String(undelivered.length) })}</p>
          )}
          {events.length === 0 ? <p className="kv-empty">{t.t('spol.firedNone')}</p> : (
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('spol.ticket')}</th>
                <th scope="col">{t.t('esc.severity')}</th>
                <th scope="col">{t.t('spol.breachKind')}</th>
                <th scope="col">{t.t('spol.when')}</th>
                <th scope="col">{t.t('spol.target')}</th>
                <th scope="col">{t.t('spol.firedAt')}</th>
                <th scope="col">{t.t('spol.evStatus')}</th>
              </tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td><Link href={`/support/tickets/${encodeURIComponent(e.ticketId)}`}>{e.ticketNo ?? e.ticketId.slice(0, 8)}</Link></td>
                    <td><span className={`kv-status ${SEV_CLASS[e.severity] ?? ''}`}>{e.severity}</span></td>
                    <td>{t.t(`spol.kind.${e.breachKind}`)}</td>
                    <td>{e.afterMinutes === 0 ? t.t('spol.atBreach') : t.t('spol.afterMin', { n: String(e.afterMinutes) })}</td>
                    <td>{t.t(`spol.channel.${e.channel}`)} · {e.targetRole}</td>
                    <td>{e.firedAt}</td>
                    <td>
                      <span className={`kv-status ${EV_CLASS[e.status] ?? ''}`}>{t.t(`spol.ev.${e.status}`)}</span>
                      {/* why a step was not delivered, on the row itself */}
                      {e.detail ? <> <span className="kv-detail__muted">{e.detail}</span></> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ---------------- version history ---------------- */}
          <h2>{t.t('spol.versionsTitle')}</h2>
          <p className="kv-field__hint">{t.t('spol.versionsHint')}</p>
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('spol.version')}</th>
              <th scope="col">{t.t('spol.name')}</th>
              <th scope="col">{t.t('spol.effectiveFrom')}</th>
              <th scope="col">{t.t('spol.evStatus')}</th>
            </tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>{t.t('spol.versionN', { n: String(v.version) })}</td>
                  <td>{v.name}</td>
                  <td>{v.effectiveFrom}</td>
                  <td>
                    <span className={`kv-status ${v.isActive ? 'kv-status--ok' : 'kv-status--muted'}`}>
                      {t.t(v.isActive ? 'spol.published' : 'spol.superseded')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ---------------- publish a new version ---------------- */}
      {!notice && (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('spol.publishTitle')}</summary>
          <p className="kv-field__hint">{t.t('spol.publishHint')}</p>
          <form action={publishSupportPolicyAction} className="kv-form">
            <label htmlFor="pol-name" className="kv-field__label">{t.t('spol.name')}</label>
            <input id="pol-name" name="name" className="kv-input" required minLength={3} maxLength={120}
              defaultValue={policy ? `${policy.name} (revised)` : ''} />

            <label htmlFor="pol-eff" className="kv-field__label">{t.t('spol.effectiveFrom')}</label>
            <input id="pol-eff" name="effectiveFrom" type="date" className="kv-input" required defaultValue={tomorrowIso()} />

            <label htmlFor="pol-open" className="kv-field__label">{t.t('spol.hours')}</label>
            <input id="pol-open" name="openHourIst" type="number" min={0} max={23} className="kv-input" required
              defaultValue={policy?.openHourIst ?? 9} />
            <input aria-label={t.t('spol.hours')} name="closeHourIst" type="number" min={1} max={24} className="kv-input" required
              defaultValue={policy?.closeHourIst ?? 21} />

            <label htmlFor="pol-routing" className="kv-field__label">{t.t('spol.routing')}</label>
            <select id="pol-routing" name="routingStrategy" className="kv-input" defaultValue={policy?.routingStrategy ?? 'least_loaded'}>
              {ROUTING_STRATEGIES.map((r) => <option key={r} value={r}>{t.t(`spol.routing.${r}`)}</option>)}
            </select>

            <label htmlFor="pol-langs" className="kv-field__label">{t.t('spol.languages')}</label>
            <input id="pol-langs" name="deskLanguages" className="kv-input" required
              defaultValue={(policy?.deskLanguages ?? ['en', 'hi', 'gu']).join(', ')} />
            <p className="kv-field__hint">{t.t('spol.languagesHint')}</p>

            <label htmlFor="pol-ai" className="kv-field__label">{t.t('spol.aiMode')}</label>
            <select id="pol-ai" name="aiAssistMode" className="kv-input" defaultValue={policy?.aiAssistMode ?? 'suggest'}>
              {AI_MODES.map((m) => <option key={m} value={m}>{t.t(`spol.ai.${m}`)}</option>)}
            </select>

            <fieldset className="kv-fieldset">
              <legend className="kv-field__label">{t.t('spol.aiExcluded')}</legend>
              {SEVERITIES.map((s) => (
                <label key={s} className="kv-check" htmlFor={`ai-ex-${s}`}>
                  <input id={`ai-ex-${s}`} type="checkbox" name="aiExcludedSeverities" value={s}
                    defaultChecked={(policy?.aiExcludedSeverities ?? ['P0', 'P1']).includes(s)} /> {s}
                </label>
              ))}
            </fieldset>

            <fieldset className="kv-fieldset">
              <legend className="kv-field__label">{t.t('spol.afterHours')}</legend>
              {SEVERITIES.map((s) => (
                <label key={s} className="kv-check" htmlFor={`ah-${s}`}>
                  <input id={`ah-${s}`} type="checkbox" name="afterHoursSeverities" value={s}
                    defaultChecked={(policy?.afterHoursSeverities ?? ['P0']).includes(s)} /> {s}
                </label>
              ))}
            </fieldset>

            {/* the targets: eight boxes, none of which may be blank — a target nobody typed is not a promise */}
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('spol.severityCol')}</th>
                <th scope="col">{t.t('spol.frCol')}</th>
                <th scope="col">{t.t('spol.resCol')}</th>
              </tr></thead>
              <tbody>
                {SEVERITIES.map((s) => {
                  const cur = slas.find((r) => r.severity === s);
                  return (
                    <tr key={s}>
                      <td><span className={`kv-status ${SEV_CLASS[s]}`}>{s}</span></td>
                      <td><input aria-label={`${s} ${t.t('spol.frCol')}`} name={`fr_${s}`} type="number" min={1} max={43200}
                        className="kv-input" required defaultValue={cur?.firstResponseMinutes ?? ''} /></td>
                      <td><input aria-label={`${s} ${t.t('spol.resCol')}`} name={`res_${s}`} type="number" min={1} max={43200}
                        className="kv-input" required defaultValue={cur?.resolutionMinutes ?? ''} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* The chain: the form IS the whole chain — publishing replaces it wholesale, and the previous version keeps
                its own steps for ever, so omitting a row loses nothing. */}
            <p className="kv-field__hint">{t.t('spol.stepBlank')}</p>
            <input type="hidden" name="stepCount" value={String(rows.length)} />
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('spol.severityCol')}</th>
                <th scope="col">{t.t('spol.when')}</th>
                <th scope="col">{t.t('spol.channel')}</th>
                <th scope="col">{t.t('spol.target')}</th>
              </tr></thead>
              <tbody>
                {rows.map((step, i) => (
                  <tr key={`step-${i}`}>
                    <td>
                      <select aria-label={t.t('spol.stepRow', { n: String(i + 1) })} name={`step_${i}_severity`}
                        className="kv-input" defaultValue={step?.severity ?? ''}>
                        <option value="" />
                        {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      <input aria-label={t.t('spol.when')} name={`step_${i}_afterMinutes`} type="number" min={0} max={10080}
                        className="kv-input" defaultValue={step ? String(step.afterMinutes) : ''} />
                    </td>
                    <td>
                      <select aria-label={t.t('spol.channel')} name={`step_${i}_channel`} className="kv-input"
                        defaultValue={step?.channel ?? 'in_app'}>
                        {ESCALATION_CHANNELS.map((c) => (
                          <option key={c} value={c}>
                            {t.t(`spol.channel.${c}`)}{wakesSomebody(c) ? ` — ${t.t('spol.wakes')}` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input aria-label={t.t('spol.target')} name={`step_${i}_targetRole`} className="kv-input"
                        maxLength={60} defaultValue={step?.targetRole ?? ''} placeholder="support_head" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="kv-field__hint">{t.t('spol.addSteps')}</p>

            <label htmlFor="pol-notes" className="kv-field__label">{t.t('spol.notes')}</label>
            <input id="pol-notes" name="notes" className="kv-input" maxLength={2000} />

            <button type="submit" className="kv-btn">{t.t('spol.publish')}</button>
          </form>
        </details>
      )}
    </section>
  );
}
