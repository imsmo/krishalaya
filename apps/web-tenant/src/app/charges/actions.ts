'use server';
// apps/web-tenant/src/app/charges/actions.ts · W150's propose / decide / apply (PC-56 TENANT-3c-2).
// All three need `tenant.settings` server-side, and the checker must be a different person than the proposer — the
// service and 0141's CHECK both refuse otherwise. Every refusal is translated BY NAME: a fee change that fails with
// "something went wrong" gets pressed again with the same wrong figure.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { isAllowedEffectiveFrom, isOfferedCalcMethod } from '../../features/charges/console';
import { SdkError } from '@krishalaya/sdk-js';

const ERRORS: Record<string, string> = {
  CHARGE_NOTE_TOO_SHORT: 'noteShort',
  CHARGE_EFFECTIVE_NOT_FUTURE: 'effectivePast',
  CHARGE_EFFECTIVE_BEFORE_CURRENT: 'effectiveBefore',
  CHARGE_EFFECTIVE_INVALID: 'effective',
  CHARGE_METHOD_UNSUPPORTED: 'method',
  CHARGE_PROPOSAL_DUPLICATE: 'duplicate',
  CHARGE_PROPOSAL_DECIDED: 'decided',
  CHARGE_CHECKER_IS_MAKER: 'checkerIsMaker',
  CHARGE_NO_OVERRIDE_TO_END: 'noOverride',
  CHARGE_FORBIDDEN: 'forbidden',
};
function keyOf(e: unknown): string {
  const code = e instanceof SdkError ? String((e as { code?: string }).code ?? '') : '';
  if (ERRORS[code]) return ERRORS[code];
  // Every CHARGE_CONFIG_* refusal is a malformed fee configuration; the message on screen names the class and the
  // API's detail carries the specific field.
  if (code.startsWith('CHARGE_CONFIG_')) return 'config';
  if (e instanceof SdkError && e.status === 403) return 'forbidden';
  if (e instanceof SdkError && e.status === 404) return 'notFound';
  return 'generic';
}
function back(qs: string): never { redirect(`/charges?${qs}`); }

export async function proposeChargeAction(formData: FormData): Promise<void> {
  await requireSession('/charges');
  const chargeCode = String(formData.get('chargeCode') ?? '').trim();
  const action = String(formData.get('action') ?? 'change');
  const calcMethod = String(formData.get('calcMethod') ?? '').trim();
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  const label = String(formData.get('label') ?? '').trim();
  const rawConfig = String(formData.get('config') ?? '').trim();

  if (!/^[a-z][a-z0-9_]*$/.test(chargeCode)) back('error=config');
  if (note.length < 20) back('error=noteShort');
  if (!isAllowedEffectiveFrom(effectiveFrom, new Date())) back('error=effectivePast');
  let config: Record<string, unknown> | undefined;
  if (action !== 'end') {
    if (!isOfferedCalcMethod(calcMethod)) back('error=method');
    try { config = rawConfig ? JSON.parse(rawConfig) : undefined; } catch { back('error=config'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) back('error=config');
  }
  try {
    await tenantClient().payments.charges.propose({
      chargeCode, action: action as 'add' | 'change' | 'end',
      label: label || undefined,
      calcMethod: action === 'end' ? undefined : (calcMethod as 'flat' | 'percent' | 'slab' | 'per_unit'),
      config: action === 'end' ? undefined : config,
      effectiveFrom, note,
    });
  } catch (e) { back(`error=${keyOf(e)}`); }
  revalidatePath('/charges');
  back('ok=proposed');
}

export async function decideChargeAction(formData: FormData): Promise<void> {
  await requireSession('/charges');
  const proposalId = String(formData.get('proposalId') ?? '').trim();
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (!proposalId) back('error=notFound');
  if (decision !== 'approved' && decision !== 'rejected') back('error=generic');
  // A REFUSAL OWES THE PROPOSER A SENTENCE (0141's CHECK); an approval does not — forcing one produces "ok".
  if (decision === 'rejected' && note.length < 20) back('error=noteShort');
  try {
    await tenantClient().payments.charges.decide(proposalId, { decision, note: note || undefined });
  } catch (e) { back(`error=${keyOf(e)}`); }
  revalidatePath('/charges');
  back(`ok=${decision}`);
}

export async function applyChargeAction(formData: FormData): Promise<void> {
  await requireSession('/charges');
  const proposalId = String(formData.get('proposalId') ?? '').trim();
  if (!proposalId) back('error=notFound');
  try { await tenantClient().payments.charges.apply(proposalId); }
  catch (e) { back(`error=${keyOf(e)}`); }
  revalidatePath('/charges');
  revalidatePath('/invoices');
  back('ok=applied');
}
