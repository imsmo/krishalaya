'use server';
// apps/web-tenant/src/app/settings/org/actions.ts · the writes of W186 and its chains — PC-56 TENANT-13b.
//
//   • saveSettingAction  — the form chain's Submit (W2755 → W2756 / W2757): an ORDINARY key is written directly (before/after + reason);
//                           a TRUST-AFFECTING key becomes a PROPOSAL — never the value. The API decides the route again; this only picks
//                           the call the review said it would make.
//   • proposalActAction  — the mutate chain (W2758 → W2759 / W2760): confirm (a DIFFERENT tenant_admin — the database refuses the
//                           proposer) or refuse with a reason.
//   • saveLanguagesAction — the Languages panel: tenant_languages, the store every consumer reads (F-14).
// Every write carries the Idempotency-Key the page minted. Redirects carry outcome CODES and the values the chain needs — never more.
// 'use server' modules export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { EDIT_HREF, ORG_HREF, failureCodesFrom, isIdemKey, isSettingKey, isUuid, parseValue, proposalHref } from '../../../features/org-settings/org-settings';

const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return err ? failureCodesFrom(err.code, err.status, err.details) : ['unknown']; };
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

export async function saveSettingAction(formData: FormData): Promise<void> {
  await requireSession(EDIT_HREF);
  const key = String(formData.get('key') ?? '');
  if (!isSettingKey(key)) redirect(ORG_HREF);
  const type = String(formData.get('type') ?? '') as 'string' | 'int' | 'decimal' | 'bool' | 'json';
  const raw = String(formData.get('value') ?? '').slice(0, 4000);
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  const route = String(formData.get('route') ?? '');
  const idem = String(formData.get('idempotencyKey') ?? '');
  const back = { key, value: raw, reason };
  const parsed = parseValue(type, raw);
  if (!parsed.ok) redirect(`${EDIT_HREF}?${qs({ ...back, step: 'failure', error: 'VALUE_UNPARSEABLE' })}`);
  const key2 = isIdemKey(idem) ? idem : randomUUID();
  const c = tenantClient();
  let failed: string[] | null = null; let proposalId = ''; let historyId = '';
  try {
    if (route === 'proposal') proposalId = (await c.orgSettings.propose({ key, value: parsed.value, reason }, key2)).id;
    else historyId = (await c.orgSettings.put({ key, value: parsed.value, reason: reason || null }, key2)).historyId;
  } catch (e) { failed = codesOf(e); }
  revalidatePath(ORG_HREF);
  if (failed) redirect(`${EDIT_HREF}?${qs({ ...back, step: 'failure', error: failed.join(',') })}`);
  redirect(`${EDIT_HREF}?${qs({ key, step: 'success', route: route === 'proposal' ? 'proposal' : 'direct', ...(proposalId ? { proposal: proposalId } : {}), ...(isUuid(historyId) ? { history: historyId } : {}) })}`);
}

export async function proposalActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const act = String(formData.get('act') ?? '') === 'refuse' ? 'refuse' : 'confirm';
  await requireSession(ORG_HREF);
  if (!isUuid(id)) redirect(ORG_HREF);
  const idem = String(formData.get('idempotencyKey') ?? '');
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  const key2 = isIdemKey(idem) ? idem : randomUUID();
  let failed: string[] | null = null;
  try {
    if (act === 'confirm') await tenantClient().orgSettings.confirm(id, key2);
    else await tenantClient().orgSettings.refuse(id, reason, key2);
  } catch (e) { failed = codesOf(e); }
  revalidatePath(ORG_HREF);
  if (failed) redirect(`${proposalHref(id, act, 'failure')}&error=${encodeURIComponent(failed.join(','))}`);
  redirect(proposalHref(id, act, 'success'));
}

export async function saveLanguagesAction(formData: FormData): Promise<void> {
  await requireSession(ORG_HREF);
  const enabled = formData.getAll('enabled').map((x) => String(x).trim()).filter((x) => /^[a-z]{2,3}(-[A-Z]{2})?$/.test(x)).slice(0, 20);
  const primary = String(formData.get('primary') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 500);
  let failed: string[] | null = null; let uses = '';
  try { await tenantClient().orgSettings.putLanguages({ enabled, primary, reason: reason || null }, randomUUID()); }
  catch (e) {
    failed = codesOf(e);
    const u = (e instanceof SdkError ? (e.details as { uses?: Array<{ code: string; kind: string; count: number }> } | undefined)?.uses : undefined) ?? [];
    uses = u.filter((x) => /^[a-z-]{2,8}$/i.test(x.code) && /^[a-z]{2,12}$/.test(x.kind)).map((x) => `${x.code}:${x.kind}:${Number(x.count) | 0}`).slice(0, 12).join(',');
  }
  revalidatePath(ORG_HREF);
  if (failed) redirect(`${ORG_HREF}?${qs({ langError: failed.join(','), ...(uses ? { uses } : {}) })}#languages`);
  redirect(`${ORG_HREF}?langOk=1#languages`);
}
