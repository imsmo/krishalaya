'use server';
// apps/web-tenant/src/app/marketplace/requirements/[id]/act/actions.ts · W2369 / W2370 · the requirement acts — PC-56 TENANT-11d.
// send (after member consent) · accept (by quantity) · accept / decline a pooled quote · shortlist · reject · close · withdraw ·
// remove a line. Re-judged by the API on the locked rows (the confirm step is not an authorisation token). When the desk decides
// for the buyer, the buyer's consent (channel + evidence) travels with the act. CONSENT_MISSING's member names ride to the failure
// screen (short names only). The reason never travels into a success URL — it is on the audit row, which the screen reads back.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { ConsentInput } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { BUYER_DECISIONS, CONSENT_CHANNELS, REQUIREMENTS_HREF, actBase, failureCodesFrom, isAct, isQty, isUuid, missingNames, reqHref } from '../../../../../features/requirements/console';

export async function requirementActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = actBase(id);
  await requireSession(base);
  const actRaw = String(formData.get('act') ?? '');
  if (!isUuid(id) || !isAct(actRaw)) redirect(REQUIREMENTS_HREF);
  const act = actRaw;
  const s = (k: string) => String(formData.get(k) ?? '').trim();
  const gid = isUuid(s('gid')) ? s('gid') : ''; const rid = isUuid(s('rid')) ? s('rid') : ''; const lid = isUuid(s('lid')) ? s('lid') : '';
  const reason = s('reason');
  const channel = s('consentChannel');
  const consent: ConsentInput | undefined = BUYER_DECISIONS.includes(act) && (CONSENT_CHANNELS as readonly string[]).includes(channel)
    ? { channel: channel as ConsentInput['channel'], ...(isUuid(s('consentMediaId')) ? { mediaId: s('consentMediaId') } : {}) } : undefined;
  const c = tenantClient();
  let failed: string[] | null = null; let names: string[] = []; let extra = '';
  try {
    if (act === 'send') { const g = await c.requirements.sendGroup(id, gid); extra = `&sent=${g.linkedResponses ?? g.lineCount}`; }
    else if (act === 'withdraw') await c.requirements.withdrawGroup(id, gid, reason);
    else if (act === 'removeLine') await c.requirements.removeLine(id, gid, lid);
    else if (act === 'close') await c.requirements.close(id, reason || undefined);
    else if (act === 'acceptGroup') { const r = await c.responses.acceptGroup(gid, consent); extra = `&status=${encodeURIComponent(r.requirement.status)}`; }
    else if (act === 'rejectGroup') await c.responses.rejectGroup(gid, consent);
    else if (act === 'accept') {
      const qty = s('quantity');
      const r = await c.responses.accept(rid, { ...(qty && isQty(qty) ? { quantity: qty } : {}), ...(consent ? { consent } : {}) });
      extra = r.requirement ? `&status=${encodeURIComponent(r.requirement.status)}` : '';
    } else if (act === 'shortlist') await c.responses.shortlist(rid, consent);
    else await c.responses.reject(rid, consent);
  } catch (e) {
    failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status) : ['unknown'];
    names = e instanceof SdkError ? missingNames(e.details) : [];
  }
  const ids = `${gid ? `&gid=${gid}` : ''}${rid ? `&rid=${rid}` : ''}${lid ? `&lid=${lid}` : ''}`;
  if (failed) redirect(`${base}?step=failure&act=${act}${ids}&error=${encodeURIComponent(failed.join(','))}${names.length ? `&names=${encodeURIComponent(names.join('|'))}` : ''}`);
  revalidatePath(REQUIREMENTS_HREF); revalidatePath(reqHref(id));
  redirect(`${base}?step=success&act=${act}${ids}${extra}`);
}
