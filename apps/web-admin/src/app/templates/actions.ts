'use server';
// apps/web-admin/src/app/templates/actions.ts · W101/W102 chains (PC-56 ADMIN-11b).
//
// admin-api re-authorises every one of these server-side: `templates.manage` to author, `templates.approve` to approve,
// FIDO2 + step-up on approval, a reason of at least twenty characters, and — on security copy — a different
// administrator from the one who wrote the words.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, AdminApiError } from '../../lib/admin-client';

/** The refusal an operator can act on. **THIS PLANE'S 403 MEANS THREE DIFFERENT THINGS** and the message decides
 *  between them: the elevation was stale, a second administrator is needed, or the wording is security copy that takes
 *  no tenant override. Conflating them would tell an author to re-authenticate when what they need is a colleague — or
 *  when what they need is to stop trying. */
function apiErrorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    const msg = String(e.message ?? '');
    if (e.status === 403) {
      if (/platform-controlled|opt-out-locked/i.test(msg)) return 'securityCopy';
      return /second|checker|cannot approve|author/i.test(msg) ? 'secondPerson' : 'elevation';
    }
    if (e.status === 409) return /registration|DLT|WhatsApp template/i.test(msg) ? 'needsRef' : 'conflict';
    // 422 carries the authoring verdict — every problem at once, which is what W2282 asks for.
    if (e.status === 422) return 'invalid';
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}

const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

/** Author a new version. **NOTHING A RECIPIENT RECEIVES CHANGES HERE** — the draft lands beside the approved version and
 *  the serving pointer does not move until somebody approves it. */
export async function authorVersionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const templateId = str(formData, 'templateId');
  const eventCode = str(formData, 'eventCode');
  const channel = str(formData, 'channel');
  const languageCode = str(formData, 'languageCode');
  const body = String(formData.get('body') ?? '');
  const reason = str(formData, 'reason');
  const subject = str(formData, 'subject');
  const providerTemplateRef = str(formData, 'providerTemplateRef');
  const tenantId = str(formData, 'tenantId');
  const back = templateId ? `/templates/${enc(templateId)}` : '/templates';

  if (!eventCode || !channel || !languageCode || body.trim().length === 0) redirect(`${back}?error=invalid`);
  if (reason.length < 20) redirect(`${back}?error=reason`);
  try {
    await adminPost('templates/versions', {
      body: {
        eventCode, channel, languageCode, body, reason,
        ...(subject ? { subject } : {}),
        ...(providerTemplateRef ? { providerTemplateRef } : {}),
        ...(tenantId ? { tenantId } : {}),
      },
    });
  } catch (e) { redirect(`${back}?error=${apiErrorKey(e)}`); }
  revalidatePath(back); revalidatePath('/templates');
  redirect(`${back}?ok=drafted`);
}

/** Send for out-of-band provider review. **NOTHING IS SUBMITTED TO A PROVIDER BY THIS CALL** — there is no Meta or DLT
 *  client in this monorepo, and the state means "a human has taken this to them" (ADMIN-11b-Q1). */
export async function submitVersionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const versionId = str(formData, 'versionId');
  const templateId = str(formData, 'templateId');
  const reason = str(formData, 'reason');
  const back = `/templates/${enc(templateId)}`;
  if (!versionId) redirect('/templates');
  if (reason.length < 20) redirect(`${back}?error=reason`);
  try {
    await adminPost(`templates/versions/${enc(versionId)}/submit`, { body: { reason } });
  } catch (e) { redirect(`${back}?error=${apiErrorKey(e)}`); }
  revalidatePath(back);
  redirect(`${back}?ok=submitted`);
}

/** **THE ONLY ACTION ON THIS PLANE A RECIPIENT CAN SEE.** It moves the serving pointer, supersedes the wording it
 *  replaces, and on security copy it refuses the author of the version. */
export async function approveVersionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const versionId = str(formData, 'versionId');
  const templateId = str(formData, 'templateId');
  const reason = str(formData, 'reason');
  const back = `/templates/${enc(templateId)}`;
  if (!versionId) redirect('/templates');
  if (reason.length < 20) redirect(`${back}?error=reason`);
  try {
    await adminPost(`templates/versions/${enc(versionId)}/approve`, { body: { reason } });
  } catch (e) { redirect(`${back}?error=${apiErrorKey(e)}`); }
  revalidatePath(back); revalidatePath('/templates');
  redirect(`${back}?ok=approved`);
}

/** Rejecting is the restrictive direction and is deliberately NOT elevated — the safe act must never be the harder one. */
export async function rejectVersionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const versionId = str(formData, 'versionId');
  const templateId = str(formData, 'templateId');
  const reason = str(formData, 'reason');
  const back = `/templates/${enc(templateId)}`;
  if (!versionId) redirect('/templates');
  // The rejection reason IS the record — it is stored on the version and shown to whoever tries again.
  if (reason.length < 20) redirect(`${back}?error=reason`);
  try {
    await adminPost(`templates/versions/${enc(versionId)}/reject`, { body: { reason } });
  } catch (e) { redirect(`${back}?error=${apiErrorKey(e)}`); }
  revalidatePath(back);
  redirect(`${back}?ok=rejected`);
}

/** Record a DLT header / WhatsApp number / From address. **'recorded' MEANS AN OPERATOR TYPED IT IN** — no provider
 *  verifies it, because none is wired (ADMIN-11b-Q2), and the console says so on every row. */
export async function registerSenderAction(formData: FormData): Promise<void> {
  requireAdmin();
  const channel = str(formData, 'channel');
  const sender = str(formData, 'sender');
  const countryCode = str(formData, 'countryCode').toUpperCase();
  const reason = str(formData, 'reason');
  if (!channel || !sender || countryCode.length !== 2) redirect('/templates/senders?error=invalid');
  if (reason.length < 20) redirect('/templates/senders?error=reason');
  try {
    await adminPost('templates/senders', {
      body: {
        channel, sender, countryCode, reason,
        ...(str(formData, 'entityId') ? { entityId: str(formData, 'entityId') } : {}),
        ...(str(formData, 'provider') ? { provider: str(formData, 'provider') } : {}),
        ...(str(formData, 'note') ? { note: str(formData, 'note') } : {}),
      },
    });
  } catch (e) { redirect(`/templates/senders?error=${apiErrorKey(e)}`); }
  revalidatePath('/templates/senders');
  redirect('/templates/senders?ok=registered');
}
