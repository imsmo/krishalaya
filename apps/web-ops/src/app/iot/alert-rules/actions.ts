'use server';
// apps/web-ops/src/app/iot/alert-rules/actions.ts · PC-56 OPS-5a · W402's change act, REAL (the alert chain W3292 → W3293 / W3294), over the API
// HOTFIX-14 built (OPS-5 Q3-A, lead-applied): propose a change to a rule (`PATCH …/alert-rules/:id` — the SERVER answers 200 `applied` for a
// louder change, 202 `proposed` for one that could make an alert quieter), make a new rule (`POST …/alert-rules`, applied at once), confirm
// another person's proposal, withdraw your own. Every call is keyed (the key minted when the form was shown, so a double submit replays) and
// carries a reason where the API asks one; the API decides and records. The outcome: `?act=success&done=<what the server did>` or
// `?act=failure&reason=<named refusal>`; a field the form itself refuses → back to the form with its error.
// NEVER here (source assertion, test/ops5a-pages.spec.ts): a breach act, a threshold (band), "run the rules now", an acknowledge.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { opsClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { buildAlertRule, isAlertKind } from '../../../features/devices/alerting';
import { ALERTS, buildChange, changeDraft, changeFailure, keyParam, uuidParam, type ChangeFailure } from '../../../features/ops5/alerts';

const failed = (e: unknown): ChangeFailure => (e instanceof SdkError ? changeFailure(e.status, e.code ?? null) : 'save');
const fail = (reason: ChangeFailure, rule?: string | null): never => redirect(`${ALERTS.rules}?act=failure&reason=${reason}${rule ? `&rule=${rule}` : ''}`);

/** Propose (or, when louder, apply) a change to ONE rule. The rule's current people and threshold are read HERE, server-side, so the page never
 *  prints the ids a rule holds: the person types only whom to add and whom to remove. */
export async function proposeChangeAction(formData: FormData): Promise<void> {
  await requireSession(ALERTS.rules);
  const id = uuidParam(String(formData.get('id') ?? ''));
  const key = keyParam(String(formData.get('key') ?? ''));
  if (!id || !key) fail('form', id);
  let current: Record<string, unknown> | undefined;
  try { current = (await opsClient().shipments.alertRules({})).find((r) => r.id === id); } catch (e) { fail(failed(e), id); }
  if (!current || !isAlertKind(String(current.kind))) fail('notFound', id);
  const c = current as Record<string, unknown>;
  const built = buildChange(String(c.kind) as Parameters<typeof buildChange>[0],
    { recipientUserIds: Array.isArray(c.recipientUserIds) ? (c.recipientUserIds as string[]) : [], threshold: (c.threshold ?? {}) as Record<string, unknown> },
    changeDraft((k) => formData.get(k)));
  if (!built.ok) redirect(`${ALERTS.rules}?act=confirm&rule=${id}&error=${built.error}`);
  let status: 'applied' | 'proposed' = 'applied';
  try { status = (await opsClient().shipments.updateAlertRule(id as string, built.value as { reason: string }, key as string)).status; }
  catch (e) { fail(failed(e), id); }
  revalidatePath(ALERTS.rules);
  redirect(`${ALERTS.rules}?act=success&done=${status === 'proposed' ? 'proposed' : 'applied'}&rule=${id}`);
}

/** A NEW rule makes alerting louder, so the API applies it at once — keyed, with a reason, recorded. */
export async function createRuleAction(formData: FormData): Promise<void> {
  await requireSession(ALERTS.rules);
  const key = keyParam(String(formData.get('key') ?? ''));
  if (!key) fail('form');
  const f = (k: string) => String(formData.get(k) ?? '');
  const built = buildAlertRule({ kind: f('kind'), ruleName: f('ruleName'), recipients: f('recipients'), channelHint: '', cooldownMinutes: f('cooldownMinutes'),
    windowHours: f('windowHours'), minBreaches: f('minBreaches'), subjectType: f('subjectType'), silentHours: f('silentHours'), maintenanceAlert: f('maintenanceAlert'), reason: f('reason') });
  if (!built.ok) redirect(`${ALERTS.rules}?act=confirm&new=1&error=${built.error}`);
  try { await opsClient().shipments.createAlertRule(built.value, key as string); }
  catch (e) { fail(failed(e)); }
  revalidatePath(ALERTS.rules);
  redirect(`${ALERTS.rules}?act=success&done=created`);
}

/** A SECOND person confirms a proposal (the server refuses the proposer by name: ALERT_RULE_CONFIRMER_IS_PROPOSER). */
export async function confirmChangeAction(formData: FormData): Promise<void> {
  await requireSession(ALERTS.rules);
  const changeId = uuidParam(String(formData.get('changeId') ?? '')); const rule = uuidParam(String(formData.get('rule') ?? ''));
  const key = keyParam(String(formData.get('key') ?? ''));
  if (!changeId || !key) fail('form', rule);
  try { await opsClient().shipments.confirmAlertRuleChange(changeId as string, key as string); }
  catch (e) { fail(failed(e), rule); }
  revalidatePath(ALERTS.rules);
  redirect(`${ALERTS.rules}?act=success&done=confirmed${rule ? `&rule=${rule}` : ''}`);
}

/** The PROPOSER withdraws their own proposal (anyone else: ALERT_RULE_WITHDRAW_NOT_PROPOSER). */
export async function withdrawChangeAction(formData: FormData): Promise<void> {
  await requireSession(ALERTS.rules);
  const changeId = uuidParam(String(formData.get('changeId') ?? '')); const rule = uuidParam(String(formData.get('rule') ?? ''));
  const key = keyParam(String(formData.get('key') ?? ''));
  if (!changeId || !key) fail('form', rule);
  try { await opsClient().shipments.withdrawAlertRuleChange(changeId as string, key as string); }
  catch (e) { fail(failed(e), rule); }
  revalidatePath(ALERTS.rules);
  redirect(`${ALERTS.rules}?act=success&done=withdrawn${rule ? `&rule=${rule}` : ''}`);
}
