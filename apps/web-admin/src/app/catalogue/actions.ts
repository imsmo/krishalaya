'use server';
// apps/web-admin/src/app/catalogue/actions.ts · god-mode master-taxonomy mutations — the ONLY place the admin
// bearer writes for the catalogue path. A master-taxonomy change ripples into every tenant's catalogue, so admin-
// api re-authorises SERVER-SIDE (catalogue.manage + FIDO2 hardware-key + step-up) and audits every change; the
// operator's mandatory reason goes in the body. No money path. admin-api exposes no Idempotency-Key here, so none
// is passed; mutations never auto-retry. 'use server' files export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { adminPost, adminPatch, adminDelete, AdminApiError } from '../../lib/admin-client';
import { buildCreateType, buildUpdateType, buildCreateValue, buildUpdateValue, buildSetActive, buildCreateCategory, buildUpdateCategory, buildMove } from '../../features/catalogue/catalogue';
import {
  buildAttribute, buildAttributeEdit, buildOption, buildBinding, buildUnit, buildConversion,
  buildSetActive as buildEavSetActive, type AttributeRow,
} from '../../features/catalogue/eav';

function errorKey(e: unknown): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'elevation';
    if (e.status === 409) return 'conflict';   // code-exists / already-in-state / parent-inactive / has-children
    if (e.status === 422) return 'invalid';      // input / depth / cycle / subtree-too-large
    if (e.status === 404) return 'notFound';
  }
  return 'generic';
}
const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

/* ---- lookup types ---- */
export async function createTypeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const built = buildCreateType({ code: str(formData, 'code'), defaultName: str(formData, 'defaultName'), isTenantExtendable: str(formData, 'isTenantExtendable'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/catalogue?error=${built.error}`);
  try { await adminPost('catalogue/lookup-types', { body: built.value }); }
  catch (e) { redirect(`/catalogue?error=${errorKey(e)}`); }
  revalidatePath('/catalogue');
  redirect(`/catalogue/lookup-types/${enc(built.value.code)}?ok=created`);
}

export async function updateTypeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const code = str(formData, 'code').trim();
  if (!code) redirect('/catalogue');
  const built = buildUpdateType({ defaultName: str(formData, 'defaultName'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/catalogue/lookup-types/${enc(code)}?error=${built.error}`);
  try { await adminPatch(`catalogue/lookup-types/${enc(code)}`, { body: built.value }); }
  catch (e) { redirect(`/catalogue/lookup-types/${enc(code)}?error=${errorKey(e)}`); }
  revalidatePath(`/catalogue/lookup-types/${code}`);
  redirect(`/catalogue/lookup-types/${enc(code)}?ok=updated`);
}

/* ---- lookup values ---- */
export async function createValueAction(formData: FormData): Promise<void> {
  requireAdmin();
  const built = buildCreateValue({ typeCode: str(formData, 'typeCode'), code: str(formData, 'code'), defaultName: str(formData, 'defaultName'), meta: str(formData, 'meta'), sortOrder: str(formData, 'sortOrder'), reason: str(formData, 'reason') });
  const typeCode = str(formData, 'typeCode').trim();
  if (!built.ok) redirect(`/catalogue/lookup-types/${enc(typeCode)}?error=${built.error}`);
  let id: string | undefined;
  try { id = (await adminPost<{ id: string }>('catalogue/lookup-values', { body: built.value })).data?.id; }
  catch (e) { redirect(`/catalogue/lookup-types/${enc(typeCode)}?error=${errorKey(e)}`); }
  revalidatePath(`/catalogue/lookup-types/${typeCode}`);
  redirect(id ? `/catalogue/lookup-values/${enc(id)}?ok=created` : `/catalogue/lookup-types/${enc(typeCode)}?ok=created`);
}

export async function updateValueAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/catalogue');
  const built = buildUpdateValue({ defaultName: str(formData, 'defaultName'), meta: str(formData, 'meta'), sortOrder: str(formData, 'sortOrder'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/catalogue/lookup-values/${enc(id)}?error=${built.error}`);
  try { await adminPatch(`catalogue/lookup-values/${enc(id)}`, { body: built.value }); }
  catch (e) { redirect(`/catalogue/lookup-values/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/catalogue/lookup-values/${id}`);
  redirect(`/catalogue/lookup-values/${enc(id)}?ok=updated`);
}

export async function setValueActiveAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/catalogue');
  const built = buildSetActive({ isActive: str(formData, 'isActive'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/catalogue/lookup-values/${enc(id)}?error=${built.error}`);
  try { await adminPost(`catalogue/lookup-values/${enc(id)}/active`, { body: built.value }); }
  catch (e) { redirect(`/catalogue/lookup-values/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/catalogue/lookup-values/${id}`);
  redirect(`/catalogue/lookup-values/${enc(id)}?ok=${built.value.isActive ? 'activated' : 'deactivated'}`);
}

/* ---- categories ---- */
export async function createCategoryAction(formData: FormData): Promise<void> {
  requireAdmin();
  const built = buildCreateCategory({
    parentId: str(formData, 'parentId'), slug: str(formData, 'slug'), defaultName: str(formData, 'defaultName'),
    commerceKind: str(formData, 'commerceKind'), requiresLicense: str(formData, 'requiresLicense'), requiresCertificate: str(formData, 'requiresCertificate'),
    minAge: str(formData, 'minAge'), sortOrder: str(formData, 'sortOrder'), iconMediaId: str(formData, 'iconMediaId'), reason: str(formData, 'reason'),
  });
  const back = built.ok && built.value.parentId ? `/catalogue/categories/${enc(built.value.parentId)}` : '/catalogue/categories';
  if (!built.ok) redirect(`/catalogue/categories?error=${built.error}`);
  let id: string | undefined;
  try { id = (await adminPost<{ id: string }>('catalogue/categories', { body: built.value })).data?.id; }
  catch (e) { redirect(`${back}?error=${errorKey(e)}`); }
  revalidatePath('/catalogue/categories');
  redirect(id ? `/catalogue/categories/${enc(id)}?ok=created` : `${back}?ok=created`);
}

export async function updateCategoryAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/catalogue/categories');
  const built = buildUpdateCategory({
    defaultName: str(formData, 'defaultName'), commerceKind: str(formData, 'commerceKind'), requiresLicense: str(formData, 'requiresLicense'),
    requiresCertificate: str(formData, 'requiresCertificate'), minAge: str(formData, 'minAge'), sortOrder: str(formData, 'sortOrder'), iconMediaId: str(formData, 'iconMediaId'), reason: str(formData, 'reason'),
  });
  if (!built.ok) redirect(`/catalogue/categories/${enc(id)}?error=${built.error}`);
  try { await adminPatch(`catalogue/categories/${enc(id)}`, { body: built.value }); }
  catch (e) { redirect(`/catalogue/categories/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/catalogue/categories/${id}`);
  redirect(`/catalogue/categories/${enc(id)}?ok=updated`);
}

export async function moveCategoryAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/catalogue/categories');
  const built = buildMove({ newParentId: str(formData, 'newParentId'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/catalogue/categories/${enc(id)}?error=${built.error}`);
  try { await adminPost(`catalogue/categories/${enc(id)}/move`, { body: built.value }); }
  catch (e) { redirect(`/catalogue/categories/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/catalogue/categories/${id}`);
  redirect(`/catalogue/categories/${enc(id)}?ok=moved`);
}

export async function setCategoryActiveAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = str(formData, 'id').trim();
  if (!id) redirect('/catalogue/categories');
  const built = buildSetActive({ isActive: str(formData, 'isActive'), reason: str(formData, 'reason') });
  if (!built.ok) redirect(`/catalogue/categories/${enc(id)}?error=${built.error}`);
  try { await adminPost(`catalogue/categories/${enc(id)}/active`, { body: built.value }); }
  catch (e) { redirect(`/catalogue/categories/${enc(id)}?error=${errorKey(e)}`); }
  revalidatePath(`/catalogue/categories/${id}`);
  redirect(`/catalogue/categories/${enc(id)}?ok=${built.value.isActive ? 'activated' : 'deactivated'}`);
}

// ---------------------------------------------------------------------------
// PC-56 ADMIN-3 · the EAV definition plane (W020's bindings tab, W024, W025, W026, W027)
// ---------------------------------------------------------------------------
// Every one of these carries a MANDATORY reason, because every one writes a `catalogue_changes` row. Before this wave
// the unit writes carried neither — the defect the migration and this wave exist to close.

const enc2 = encodeURIComponent;

/** A server 422 in this domain always names the rule it refused (Golden Law 9, a unit on a boolean, a cross-class
 *  conversion). Passed through verbatim rather than mapped: the rule IS the message. */
function passThrough422(e: unknown): string | null {
  return e instanceof AdminApiError && e.status === 422 ? e.message.slice(0, 300) : null;
}

export async function createAttributeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const back: (qs: string) => never = (qs) => redirect(`/catalogue/attributes?${qs}`);
  const built = buildAttribute((n) => String(formData.get(n) ?? ''));
  if (!built.ok) back(`error=attr_${built.error}`);
  try { await adminPost('catalogue/attributes', { body: built.value }); }
  catch (e) {
    const why = passThrough422(e);
    if (why) back(`error=attr_rejected&why=${enc2(why)}`);
    if (e instanceof AdminApiError && e.status === 409) back('error=attr_duplicate');
    back(`error=${errorKey(e)}`);
  }
  revalidatePath('/catalogue/attributes');
  back('ok=attr_created');
}

/**
 * Save an attribute edit. THE CHECKER GATE SURFACES HERE.
 *
 * The server answers 409 CATALOGUE_CHECKER_REQUIRED with the consequences in its message when the change re-interprets
 * stored data. That is passed back to the page verbatim so the operator READS what the change does; ticking the
 * acknowledgement re-submits with `acknowledgeConsequences`. Deliberately two steps, and deliberately not a modal that
 * summarises: the consequence text is computed from the real binding count and must not be paraphrased.
 */
export async function updateAttributeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/catalogue/attributes');
  const back: (qs: string) => never = (qs) => redirect(`/catalogue/attributes/${enc2(id)}?${qs}`);
  const current: Pick<AttributeRow, 'defaultName' | 'dataType' | 'unitCode' | 'validation'> = {
    defaultName: String(formData.get('currentName') ?? ''),
    dataType: String(formData.get('currentType') ?? ''),
    unitCode: String(formData.get('currentUnit') ?? '') || null,
    validation: (() => {
      const raw = String(formData.get('currentValidation') ?? '').trim();
      if (!raw) return {};
      try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
    })(),
  };
  const built = buildAttributeEdit((n) => String(formData.get(n) ?? ''), current);
  if (!built.ok) back(`error=attr_${built.error}`);
  try { await adminPatch(`catalogue/attributes/${enc2(id)}`, { body: built.value }); }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 409) {
      // the consequences, verbatim — this is the operator's only chance to read them before confirming
      back(`error=attr_checker&why=${enc2(e.message.slice(0, 500))}`);
    }
    const why = passThrough422(e);
    if (why) back(`error=attr_rejected&why=${enc2(why)}`);
    back(`error=${errorKey(e)}`);
  }
  revalidatePath(`/catalogue/attributes/${id}`);
  revalidatePath('/catalogue/attributes');
  back('ok=attr_updated');
}

export async function setAttributeActiveAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/catalogue/attributes');
  const back: (qs: string) => never = (qs) => redirect(`/catalogue/attributes/${enc2(id)}?${qs}`);
  const built = buildEavSetActive((n) => String(formData.get(n) ?? ''));
  if (!built.ok) back(`error=attr_${built.error}`);
  try { await adminPost(`catalogue/attributes/${enc2(id)}/active`, { body: built.value }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath(`/catalogue/attributes/${id}`);
  revalidatePath('/catalogue/attributes');
  back(built.value.isActive ? 'ok=attr_activated' : 'ok=attr_deactivated');
}

export async function createOptionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const attributeId = String(formData.get('attributeId') ?? '').trim();
  if (!attributeId) redirect('/catalogue/attributes');
  const back: (qs: string) => never = (qs) => redirect(`/catalogue/attributes/${enc2(attributeId)}?${qs}`);
  const built = buildOption((n) => String(formData.get(n) ?? ''));
  if (!built.ok) back(`error=opt_${built.error}`);
  try { await adminPost(`catalogue/attributes/${enc2(attributeId)}/options`, { body: built.value }); }
  catch (e) {
    const why = passThrough422(e);
    if (why) back(`error=opt_rejected&why=${enc2(why)}`);
    if (e instanceof AdminApiError && e.status === 409) back('error=opt_duplicate');
    back(`error=${errorKey(e)}`);
  }
  revalidatePath(`/catalogue/attributes/${attributeId}`);
  back('ok=opt_created');
}

export async function setOptionActiveAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const attributeId = String(formData.get('attributeId') ?? '').trim();
  const back: (qs: string) => never = (qs) => redirect(`/catalogue/attributes/${enc2(attributeId)}?${qs}`);
  if (!id) back('error=opt_generic');
  const built = buildEavSetActive((n) => String(formData.get(n) ?? ''));
  if (!built.ok) back(`error=opt_${built.error}`);
  try { await adminPost(`catalogue/options/${enc2(id)}/active`, { body: built.value }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath(`/catalogue/attributes/${attributeId}`);
  back(built.value.isActive ? 'ok=opt_activated' : 'ok=opt_deactivated');
}

export async function bindAttributeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const categoryId = String(formData.get('categoryId') ?? '').trim();
  if (!categoryId) redirect('/catalogue/categories');
  const back: (qs: string) => never = (qs) => redirect(`/catalogue/categories/${enc2(categoryId)}/bindings?${qs}`);
  const built = buildBinding((n) => String(formData.get(n) ?? ''));
  if (!built.ok) back(`error=bind_${built.error}`);
  try { await adminPost(`catalogue/categories/${enc2(categoryId)}/bindings`, { body: built.value }); }
  catch (e) {
    const why = passThrough422(e);
    if (why) back(`error=bind_rejected&why=${enc2(why)}`);
    if (e instanceof AdminApiError && e.status === 409) back('error=bind_duplicate');
    back(`error=${errorKey(e)}`);
  }
  revalidatePath(`/catalogue/categories/${categoryId}/bindings`);
  back('ok=bind_bound');
}

export async function updateBindingAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const categoryId = String(formData.get('categoryId') ?? '').trim();
  const back: (qs: string) => never = (qs) => redirect(`/catalogue/categories/${enc2(categoryId)}/bindings?${qs}`);
  if (!id) back('error=bind_generic');
  const built = buildBinding((n) => String(formData.get(n) ?? ''));
  if (!built.ok) back(`error=bind_${built.error}`);
  try { await adminPatch(`catalogue/bindings/${enc2(id)}`, { body: built.value }); }
  catch (e) {
    const why = passThrough422(e);
    if (why) back(`error=bind_rejected&why=${enc2(why)}`);
    back(`error=${errorKey(e)}`);
  }
  revalidatePath(`/catalogue/categories/${categoryId}/bindings`);
  back('ok=bind_updated');
}

/** Unbind. POSTed rather than DELETEd from the console because a Server Action form cannot issue a DELETE — the API's
 *  verb is DELETE and this action calls it through the client's own delete helper. */
export async function unbindAttributeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const id = String(formData.get('id') ?? '').trim();
  const categoryId = String(formData.get('categoryId') ?? '').trim();
  const back: (qs: string) => never = (qs) => redirect(`/catalogue/categories/${enc2(categoryId)}/bindings?${qs}`);
  if (!id) back('error=bind_generic');
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < 10) back('error=bind_reason');
  try { await adminDelete(`catalogue/bindings/${enc2(id)}`, { body: { reason } }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath(`/catalogue/categories/${categoryId}/bindings`);
  back('ok=bind_unbound');
}

export async function createUnitAction(formData: FormData): Promise<void> {
  requireAdmin();
  const back: (qs: string) => never = (qs) => redirect(`/catalogue/units?${qs}`);
  const built = buildUnit((n) => String(formData.get(n) ?? ''));
  if (!built.ok) back(`error=unit_${built.error}`);
  try { await adminPost('catalogue/units', { body: built.value }); }
  catch (e) {
    const why = passThrough422(e);
    if (why) back(`error=unit_rejected&why=${enc2(why)}`);
    if (e instanceof AdminApiError && e.status === 409) back('error=unit_duplicate');
    back(`error=${errorKey(e)}`);
  }
  revalidatePath('/catalogue/units');
  back('ok=unit_created');
}

export async function setUnitActiveAction(formData: FormData): Promise<void> {
  requireAdmin();
  const code = String(formData.get('code') ?? '').trim();
  const back: (qs: string) => never = (qs) => redirect(`/catalogue/units?${qs}`);
  if (!code) back('error=unit_generic');
  const built = buildEavSetActive((n) => String(formData.get(n) ?? ''));
  if (!built.ok) back(`error=unit_${built.error}`);
  try { await adminPost(`catalogue/units/${enc2(code)}/active`, { body: built.value }); }
  catch (e) { back(`error=${errorKey(e)}`); }
  revalidatePath('/catalogue/units');
  back(built.value.isActive ? 'ok=unit_activated' : 'ok=unit_deactivated');
}

/** The factor. The console never parses it — `buildConversion` validates it as text and it is sent as text, so the
 *  numeric(20,10) value the operator typed is the value the database stores. */
export async function upsertConversionAction(formData: FormData): Promise<void> {
  requireAdmin();
  const back: (qs: string) => never = (qs) => redirect(`/catalogue/units?${qs}`);
  const built = buildConversion((n) => String(formData.get(n) ?? ''));
  if (!built.ok) back(`error=unit_${built.error}`);
  try { await adminPost('catalogue/unit-conversions', { body: built.value }); }
  catch (e) {
    const why = passThrough422(e);
    if (why) back(`error=unit_rejected&why=${enc2(why)}`);
    back(`error=${errorKey(e)}`);
  }
  revalidatePath('/catalogue/units');
  back('ok=unit_factorSet');
}
