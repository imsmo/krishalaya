'use server';
// apps/web-storefront/src/app/(platform)/account/addresses/actions.ts · PC-56 STORE-4a · C3 — the address book's acts, for BOTH chromes (a hidden
// `chrome` field — `platform` or the organisation's slug; the tenant tree's pages import THESE actions, never a second copy). AUTHENTICATED.
//
// THE FORM CHAIN (W3034 → W3035 → W3036 / W3037), server-held: the values ride a short-lived httpOnly cookie (they hold a phone — never the URL).
//   reviewAddressAction — W3034: every field refused by the ONE rule (features/address/form.ts) + the label (one of the vocabulary's values)
//     + the note's bound; refused → back to the form with the values and the refusals; clean → `?step=review` (W3035).
//   submitAddressAction — W3035 Submit: create / edit under the key MINTED WHEN THE FORM RENDERED (a retry is the same request — one row; an
//     edit of an address in use answers the same copy); success → the book `?ok=…` (W3036: the saved card; `copied` → "orders already placed
//     keep the old address"); failure → the review again with the NAMED failure, the values and the key kept (W3037).
// THE MUTATE CHAIN (W3038 → W3039 / W3040): removeAddressAction / makeDefaultAddressAction from the confirm; failure → the confirm again,
//   named, with the same key (Retry).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { accountHref, chromeOf, type AccountChrome } from '../../../../features/store4a/account';
import { addressFailureOf, readKey } from '../../../../features/store4a/addresses';
import {
  ADDRESS_DRAFT_COOKIE, accountAddressValues, checkAccountAddress, accountAddressBody, accountAddressPatch, decodeAddressDraft, encodeAddressDraft,
  valuesOfAddress, withKeptPhone, type AccountAddressDraft,
} from '../../../../features/address/form';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const api = (c: AccountChrome) => serverClient(c.kind === 'tenant' ? c.slug : undefined);
const cookieOpts = (c: AccountChrome, maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, secure: true, path: accountHref(c, 'addresses'), maxAge });
const formHref = (c: AccountChrome, id: string | null, q: Record<string, string>) => (id ? accountHref(c, { edit: id }, q) : accountHref(c, 'addresses/new', q));
const keep = (c: AccountChrome, d: AccountAddressDraft) => cookies().set(ADDRESS_DRAFT_COOKIE, encodeAddressDraft(d), cookieOpts(c, 600));
const spend = (c: AccountChrome) => cookies().set(ADDRESS_DRAFT_COOKIE, '', cookieOpts(c, 0));

async function labelIds(c: AccountChrome): Promise<Set<string>> {
  try { return new Set((await api(c).lookups.values('address_label')).map((v) => v.id)); } catch { return new Set(); }
}

export async function reviewAddressAction(fd: FormData): Promise<void> {
  const c = chromeOf(fd.get('chrome'));
  const idRaw = String(fd.get('id') ?? ''); const id = UUID.test(idRaw) ? idRaw : null;
  const key = readKey(fd.get('key'));
  await requireSession(formHref(c, id, {}));
  if (!key) redirect(formHref(c, id, {}));
  const values = accountAddressValues((k) => fd.get(k));
  const errors = checkAccountAddress(values, await labelIds(c));
  const mode = id ? 'edit' : 'create';
  keep(c, { v: 1, mode, id, values, errors, failure: null });
  if (Object.keys(errors).length > 0) redirect(formHref(c, id, { k: key, error: 'form' }));   // W3034: every refusal, values kept
  redirect(formHref(c, id, { k: key, step: 'review' }));                                       // W3035
}

export async function submitAddressAction(fd: FormData): Promise<void> {
  const c = chromeOf(fd.get('chrome'));
  const idRaw = String(fd.get('id') ?? ''); const id = UUID.test(idRaw) ? idRaw : null;
  const key = readKey(fd.get('key'));
  await requireSession(formHref(c, id, {}));
  const mode = id ? 'edit' : 'create';
  const draft = decodeAddressDraft(cookies().get(ADDRESS_DRAFT_COOKIE)?.value, mode, id);
  if (!key || !draft) redirect(formHref(c, id, key ? { k: key } : {}));
  const errors = checkAccountAddress(draft.values, await labelIds(c));
  if (Object.keys(errors).length > 0) { keep(c, { ...draft, errors }); redirect(formHref(c, id, { k: key, error: 'form' })); }
  let ok: { id: string; copied: boolean } | null = null;
  let failure: string | null = null;
  try {
    if (!id) {
      const r = await api(c).addresses.create(accountAddressBody(draft.values) as never, key);
      ok = { id: r.id, copied: false };
    } else {
      const current = valuesOfAddress(await api(c).addresses.get(id));
      const patch = accountAddressPatch(current, withKeptPhone(current, draft.values));   // a blank phone on an edit keeps the current one
      if (Object.keys(patch).length === 0) ok = { id, copied: false };
      else { const r = await api(c).addresses.update(id, patch as never, key); ok = { id: r.id, copied: r.copied === true }; }
    }
  } catch (e) {
    failure = addressFailureOf(e instanceof SdkError ? e.code : null, e instanceof SdkError ? e.status : null);
  }
  if (!ok) { keep(c, { ...draft, failure }); redirect(formHref(c, id, { k: key, step: 'review', failure: failure ?? 'server' })); }   // W3037
  spend(c);
  revalidatePath(accountHref(c, 'addresses'));
  redirect(accountHref(c, 'addresses', { ok: !id ? 'created' : ok.copied ? 'copied' : 'saved', id: ok.id }));   // W3036
}

export async function removeAddressAction(fd: FormData): Promise<void> {
  const c = chromeOf(fd.get('chrome'));
  const id = String(fd.get('id') ?? ''); const key = readKey(fd.get('key'));
  await requireSession(accountHref(c, 'addresses'));
  if (!UUID.test(id) || !key) redirect(accountHref(c, 'addresses'));
  let defaultId: string | null = null;
  try { defaultId = (await api(c).addresses.remove(id)).defaultId ?? null; }
  catch (e) {
    const f = addressFailureOf(e instanceof SdkError ? e.code : null, e instanceof SdkError ? e.status : null);
    redirect(accountHref(c, 'addresses', { confirm: 'remove', id, k: key, failure: f }));   // W3040
  }
  revalidatePath(accountHref(c, 'addresses'));
  redirect(accountHref(c, 'addresses', { ok: 'removed', ...(defaultId ? { id: defaultId } : {}) }));   // W3039
}

export async function makeDefaultAddressAction(fd: FormData): Promise<void> {
  const c = chromeOf(fd.get('chrome'));
  const id = String(fd.get('id') ?? ''); const key = readKey(fd.get('key'));
  await requireSession(accountHref(c, 'addresses'));
  if (!UUID.test(id) || !key) redirect(accountHref(c, 'addresses'));
  try { await api(c).addresses.update(id, { isDefault: true }, key); }
  catch (e) {
    const f = addressFailureOf(e instanceof SdkError ? e.code : null, e instanceof SdkError ? e.status : null);
    redirect(accountHref(c, 'addresses', { confirm: 'default', id, k: key, failure: f }));   // W3040
  }
  revalidatePath(accountHref(c, 'addresses'));
  redirect(accountHref(c, 'addresses', { ok: 'default', id }));   // W3039
}
