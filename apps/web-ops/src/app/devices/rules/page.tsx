// apps/web-ops/src/app/devices/rules/page.tsx · OW-7 alert-rule CRUD (PC-55 B4, on PC-55 A6).
// Writing an alert rule is writing a promise to wake somebody up, so this form is built to make that promise
// precise:
//   • the threshold fields OFFERED are exactly the keys the API accepts for the chosen kind — an unknown key is
//     rejected server-side, and a typo that silently disabled a rule would be the worst possible outcome (an alert
//     everyone believes is armed and isn't);
//   • leaving the threshold blank sends the API's own defaults rather than nulls, so a half-filled form still
//     produces a WORKING rule;
//   • the cooldown is stated in minutes with its real bounds (5 min … 1 week), because "don't spam me" is not a
//     number the evaluator can dedupe on;
//   • recipients are platform users, and the page says plainly that their own notification preferences and QUIET
//     HOURS still apply — `channelHint` is a preference, never a bypass of somebody's night;
//   • a rule can be PAUSED but not deleted, so the alerts it already fired keep their author.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { opsClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { ALERT_KINDS, CHANNEL_HINTS, COOLDOWN_MAX, COOLDOWN_MIN, MAINTENANCE_ALERTS, MAX_RECIPIENTS, THRESHOLD_KEYS, defaultsFor } from '../../../features/devices/alerting';
import { createRuleAction, patchRuleAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('iot.rulesTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'patched', 'paused']);
const ERR = new Set(['create', 'patch', 'forbidden', 'notfound', 'conflict', 'rule',
  'r_kind', 'r_name', 'r_recipients', 'r_recipientId', 'r_tooManyRecipients', 'r_cooldown', 'r_channel', 'r_empty',
  'r_threshold_windowHours', 'r_threshold_minBreaches', 'r_threshold_subjectType', 'r_threshold_silentHours', 'r_threshold_maintenanceAlert']);

type RuleRow = {
  id?: string; kind?: string; ruleName?: string; threshold?: Record<string, unknown>;
  recipientUserIds?: string[]; channelHint?: string | null; cooldownMinutes?: number; isActive?: boolean;
  lastFiredAt?: string | null; createdAt?: string;
};

export default async function AlertRulesPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/devices/rules');
  const t = getTranslator();
  const lang = getLang();

  let rules: RuleRow[] = []; let failed = false; let forbidden = false;
  try { rules = (await opsClient().shipments.alertRules({})) as RuleRow[]; }
  catch (e) { forbidden = (e as { status?: number }).status === 403; failed = !forbidden; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('iot.rulesTitle')}</h1>
        <span>
          <Link href="/devices" className="kv-btn--link">← {t.t('iot.title')}</Link>
          {' · '}
          <Link href="/devices/alerts" className="kv-btn--link">{t.t('iot.alertsLink')}</Link>
        </span>
      </div>
      <p className="kv-field__hint">{t.t('iot.rulesHint')}</p>
      <p className="kv-notice" role="note">{t.t('iot.quietHoursNotice')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`iot.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`iot.error.${errKey}`)}</p>}
      {forbidden && <p className="kv-error" role="alert">{t.t('iot.forbidden')}</p>}
      {failed && <p className="kv-error" role="alert">{t.t('iot.loadError')}</p>}

      {!forbidden && !failed && (
        <>
          <DataTable
            rows={rules}
            empty={t.t('iot.rulesEmpty')}
            columns={[
              { header: t.t('iot.colRule'), cell: (r) => r.ruleName ?? t.t('common.dash') },
              { header: t.t('iot.colKind'), cell: (r) => t.t(`iot.kind.${r.kind}`) || String(r.kind ?? '') },
              { header: t.t('iot.colThreshold'), cell: (r) => <code>{JSON.stringify(r.threshold ?? {})}</code> },
              { header: t.t('iot.colRecipients'), cell: (r) => String((r.recipientUserIds ?? []).length) },
              { header: t.t('iot.colCooldown'), cell: (r) => t.t('iot.minutes', { n: String(r.cooldownMinutes ?? 0) }) },
              { header: t.t('iot.colChannel'), cell: (r) => (r.channelHint ? t.t(`iot.channel.${r.channelHint}`) || r.channelHint : t.t('iot.channelDefault')) },
              { header: t.t('iot.colLastFired'), cell: (r) => (r.lastFiredAt ? formatDate(r.lastFiredAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('iot.neverFired')) },
              {
                header: t.t('iot.colState'),
                cell: (r) => (
                  <form action={patchRuleAction} className="kv-inline-form">
                    <input type="hidden" name="id" value={r.id ?? ''} />
                    <input type="hidden" name="isActive" value={r.isActive === false ? '1' : '0'} />
                    <span className="kv-badge">{t.t(r.isActive === false ? 'iot.paused' : 'iot.active')}</span>{' '}
                    <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">
                      {t.t(r.isActive === false ? 'iot.resumeBtn' : 'iot.pauseBtn')}
                    </button>
                  </form>
                ),
              },
            ]}
          />
          <p className="kv-field__hint">{t.t('iot.noDeleteNote')}</p>

          <h2 className="kv-section-title">{t.t('iot.newRuleTitle')}</h2>
          <form action={createRuleAction} className="kv-card kv-form">
            <div className="kv-field">
              <label htmlFor="ru-kind" className="kv-field__label">{t.t('iot.colKind')}</label>
              <select id="ru-kind" name="kind" className="kv-select" required>
                {ALERT_KINDS.map((k) => <option key={k} value={k}>{t.t(`iot.kind.${k}`)}</option>)}
              </select>
              <p className="kv-field__hint">{t.t('iot.kindHint')}</p>
            </div>

            <div className="kv-field">
              <label htmlFor="ru-name" className="kv-field__label">{t.t('iot.ruleName')}</label>
              <input id="ru-name" name="ruleName" className="kv-input" minLength={3} maxLength={150} required aria-describedby="ru-name-hint" />
              <p id="ru-name-hint" className="kv-field__hint">{t.t('iot.ruleNameHint')}</p>
            </div>

            <fieldset className="kv-fieldset">
              <legend>{t.t('iot.thresholdLegend')}</legend>
              <p className="kv-field__hint">{t.t('iot.thresholdHint')}</p>

              <p className="kv-fine">{t.t('iot.forBreach')} ({THRESHOLD_KEYS.cold_chain_breach.join(', ')}) · {t.t('iot.defaults')}: <code>{JSON.stringify(defaultsFor('cold_chain_breach'))}</code></p>
              <label htmlFor="ru-win" className="kv-field__label">{t.t('iot.thresholdWindowHours')}</label>
              <input id="ru-win" name="windowHours" className="kv-input" inputMode="numeric" pattern="\d{1,3}" placeholder="6" />
              <label htmlFor="ru-min" className="kv-field__label">{t.t('iot.minBreaches')}</label>
              <input id="ru-min" name="minBreaches" className="kv-input" inputMode="numeric" pattern="\d{1,4}" placeholder="1" />
              <label htmlFor="ru-sub" className="kv-field__label">{t.t('iot.subjectType')}</label>
              <input id="ru-sub" name="subjectType" className="kv-input" maxLength={30} aria-describedby="ru-sub-hint" />
              <p id="ru-sub-hint" className="kv-field__hint">{t.t('iot.subjectTypeHint')}</p>

              <p className="kv-fine">{t.t('iot.forSilent')} ({THRESHOLD_KEYS.device_silent.join(', ')}) · {t.t('iot.defaults')}: <code>{JSON.stringify(defaultsFor('device_silent'))}</code></p>
              <label htmlFor="ru-sil" className="kv-field__label">{t.t('iot.silentHours')}</label>
              <input id="ru-sil" name="silentHours" className="kv-input" inputMode="numeric" pattern="\d{1,3}" placeholder="12" />

              <p className="kv-fine">{t.t('iot.forMaintenance')} ({THRESHOLD_KEYS.maintenance_due.join(', ')}) · {t.t('iot.defaults')}: <code>{JSON.stringify(defaultsFor('maintenance_due'))}</code></p>
              <label htmlFor="ru-mnt" className="kv-field__label">{t.t('iot.maintenanceAlert')}</label>
              <select id="ru-mnt" name="maintenanceAlert" className="kv-select">
                <option value="">{t.t('iot.useDefault')}</option>
                {MAINTENANCE_ALERTS.map((a) => <option key={a} value={a}>{t.t(`iot.maintenance.${a}`)}</option>)}
              </select>
            </fieldset>

            <div className="kv-field">
              <label htmlFor="ru-rcpt" className="kv-field__label">{t.t('iot.recipients')}</label>
              <textarea id="ru-rcpt" name="recipients" className="kv-textarea" rows={3} required aria-describedby="ru-rcpt-hint" />
              <p id="ru-rcpt-hint" className="kv-field__hint">{t.t('iot.recipientsHint', { max: String(MAX_RECIPIENTS) })}</p>
            </div>

            <div className="kv-field">
              <label htmlFor="ru-ch" className="kv-field__label">{t.t('iot.colChannel')}</label>
              <select id="ru-ch" name="channelHint" className="kv-select">
                <option value="">{t.t('iot.channelDefault')}</option>
                {CHANNEL_HINTS.map((c) => <option key={c} value={c}>{t.t(`iot.channel.${c}`)}</option>)}
              </select>
              <p className="kv-field__hint">{t.t('iot.channelHintNote')}</p>
              <label htmlFor="ru-cd" className="kv-field__label">{t.t('iot.colCooldown')}</label>
              <input id="ru-cd" name="cooldownMinutes" className="kv-input" inputMode="numeric" pattern="\d{1,5}" aria-describedby="ru-cd-hint" />
              <p id="ru-cd-hint" className="kv-field__hint">{t.t('iot.cooldownHint', { min: String(COOLDOWN_MIN), max: String(COOLDOWN_MAX) })}</p>
            </div>

            <div className="kv-form__actions">
              <button type="submit" className="kv-btn">{t.t('iot.createRuleBtn')}</button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
