'use server';
// apps/web-ops/src/app/devices/actions.ts · OW-7 alerting writes (PC-55 B4).
// Four acts, all Manage-gated server-side: create a rule, patch a rule (including the on/off switch), acknowledge a
// fired alert, and run the evaluator now. PC-56 HOTFIX-14: create and patch are KEYED and carry a reason; a patch that could make an
// alert quieter comes back PROPOSED (a second person confirms it — confirmChangeAction — or the proposer withdraws it).
//
// WHY "RUN NOW" EXISTS AND WHAT IT IS NOT: a rule written at a desk is useless until somebody knows it works, and
// waiting for the cadence to prove it invites the operator to write nothing at all. `evaluate` runs the SAME
// evaluator the cadence job runs — same dedupe buckets, same cooldowns — so pressing it cannot double-page anyone
// and cannot produce an alert the cadence would not have produced. It is a test button, not a broadcast button.
//
// ACKNOWLEDGE is deliberately the only thing a human can do TO an alert here: there is no delete and no edit. An
// alert is evidence that something happened; acknowledging says a person has seen it, which is a different claim
// from "it never happened".
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildAlertRule, buildRulePatch } from '../../features/devices/alerting';
import { SdkError } from '@krishalaya/sdk-js';

function backTo(path: '/devices/rules' | '/devices/alerts', qs: string): never { redirect(`${path}?${qs}`); }
// PC-56 HOTFIX-14: the second-person refusals come back BY NAME, so the page can say which one.
const NAMED: Record<string, string> = {
  ALERT_RULE_CONFIRMER_IS_PROPOSER: 'confirmerIsProposer', ALERT_RULE_CHANGE_ALREADY_OPEN: 'changeAlreadyOpen',
  ALERT_RULE_CHANGE_NOT_OPEN: 'changeNotOpen', ALERT_RULE_CHANGED_SINCE_PROPOSAL: 'changedSinceProposal',
  ALERT_RULE_WITHDRAW_NOT_PROPOSER: 'withdrawNotProposer', ALERT_RECIPIENT_NOT_MEMBER: 'recipientNotMember', REASON_REQUIRED: 'reasonRequired',
};
function errCode(e: unknown, fallback: string): string {
  if (!(e instanceof SdkError)) return fallback;
  if (NAMED[e.code]) return NAMED[e.code];
  if (e.status === 403) return 'forbidden';
  if (e.status === 404) return 'notfound';
  if (e.status === 409) return 'conflict';
  if (e.status === 400 || e.status === 422) return 'rule';   // a threshold the server re-validated and refused
  return fallback;
}

export async function createRuleAction(formData: FormData): Promise<void> {
  await requireSession('/devices/rules');
  const built = buildAlertRule({
    kind: String(formData.get('kind') ?? ''),
    ruleName: String(formData.get('ruleName') ?? ''),
    recipients: String(formData.get('recipients') ?? ''),
    channelHint: String(formData.get('channelHint') ?? ''),
    cooldownMinutes: String(formData.get('cooldownMinutes') ?? ''),
    windowHours: String(formData.get('windowHours') ?? ''),
    minBreaches: String(formData.get('minBreaches') ?? ''),
    subjectType: String(formData.get('subjectType') ?? ''),
    silentHours: String(formData.get('silentHours') ?? ''),
    maintenanceAlert: String(formData.get('maintenanceAlert') ?? ''),
    reason: String(formData.get('reason') ?? ''),
  });
  if (!built.ok) backTo('/devices/rules', `error=r_${built.error}`);
  try { await opsClient().shipments.createAlertRule(built.value, randomUUID()); }
  catch (e) { backTo('/devices/rules', `error=${errCode(e, 'create')}`); }
  revalidatePath('/devices/rules');
  backTo('/devices/rules', 'ok=created');
}

export async function patchRuleAction(formData: FormData): Promise<void> {
  await requireSession('/devices/rules');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/devices/rules');
  const built = buildRulePatch({
    isActive: String(formData.get('isActive') ?? ''),
    cooldownMinutes: String(formData.get('cooldownMinutes') ?? ''),
    ruleName: String(formData.get('ruleName') ?? ''),
    recipients: String(formData.get('recipients') ?? ''),
    reason: String(formData.get('reason') ?? ''),
  });
  if (!built.ok) backTo('/devices/rules', `error=r_${built.error}`);
  let status: 'applied' | 'proposed' = 'applied';
  try { status = (await opsClient().shipments.updateAlertRule(id, built.value as { reason: string }, randomUUID())).status; }
  catch (e) { backTo('/devices/rules', `error=${errCode(e, 'patch')}`); }
  revalidatePath('/devices/rules');
  // PC-56 HOTFIX-14: the SERVER said which — a change that could make an alert quieter is only PROPOSED (202) until a second person confirms.
  backTo('/devices/rules', status === 'proposed' ? 'ok=proposed' : 'ok=patched');
}

/** PC-56 HOTFIX-14: a second person confirms a proposed change (the server refuses the proposer by name). */
export async function confirmChangeAction(formData: FormData): Promise<void> {
  await requireSession('/devices/rules');
  const id = String(formData.get('changeId') ?? '').trim();
  if (!id) redirect('/devices/rules');
  try { await opsClient().shipments.confirmAlertRuleChange(id, randomUUID()); }
  catch (e) { backTo('/devices/rules', `error=${errCode(e, 'confirm')}`); }
  revalidatePath('/devices/rules');
  backTo('/devices/rules', 'ok=confirmed');
}

/** PC-56 HOTFIX-14: the proposer withdraws their own proposal. */
export async function withdrawChangeAction(formData: FormData): Promise<void> {
  await requireSession('/devices/rules');
  const id = String(formData.get('changeId') ?? '').trim();
  if (!id) redirect('/devices/rules');
  try { await opsClient().shipments.withdrawAlertRuleChange(id, randomUUID()); }
  catch (e) { backTo('/devices/rules', `error=${errCode(e, 'withdraw')}`); }
  revalidatePath('/devices/rules');
  backTo('/devices/rules', 'ok=withdrawn');
}

export async function acknowledgeAlertAction(formData: FormData): Promise<void> {
  await requireSession('/devices/alerts');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/devices/alerts');
  try { await opsClient().shipments.acknowledgeAlert(id); }
  catch (e) { backTo('/devices/alerts', `error=${errCode(e, 'ack')}`); }
  revalidatePath('/devices/alerts');
  backTo('/devices/alerts', 'ok=acknowledged');
}

export async function evaluateNowAction(): Promise<void> {
  await requireSession('/devices/alerts');
  let out: { evaluated: number; fired: number; suppressed: number };
  try { out = await opsClient().shipments.evaluateAlertRules(); }
  catch (e) { backTo('/devices/alerts', `error=${errCode(e, 'evaluate')}`); }
  revalidatePath('/devices/alerts');
  // The counts are reported back verbatim — including `suppressed`, which is the cooldown doing its job. Hiding it
  // would make a working dedupe look like a broken evaluator.
  const q = new URLSearchParams({ ok: 'evaluated', evaluated: String(out.evaluated), fired: String(out.fired), suppressed: String(out.suppressed) });
  backTo('/devices/alerts', q.toString());
}
