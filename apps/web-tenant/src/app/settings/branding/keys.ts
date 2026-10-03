// apps/web-tenant/src/app/settings/branding/keys.ts · the catalogue keys the client designer (BrandDesigner) needs — PC-56 TENANT-13d.
// The server page translates exactly these and hands the client a plain map (no i18n runtime in the browser). The spec checks every key
// exists in en / hi / gu.
import { BRAND_REFUSAL_CODES, DRAFT_FIELDS } from '../../../features/branding/branding';

const PAIRS = ['primary_on_surface', 'accent_on_ink', 'ink_on_surface', 'surface_on_primary'];

export function brandDesignerKeys(): string[] {
  return [
    'br.form.step.edit', 'br.form.step.review', 'br.form.step.formError', 'br.form.step.success', 'br.form.step.failure',
    'br.identity.title', 'br.field.displayName', 'br.field.appShortName', 'br.field.appShortNameHint', 'br.field.primary', 'br.field.accent', 'br.field.ink',
    'br.field.surface', 'br.field.poweredByHidden', 'br.field.poweredByHint', 'br.field.poweredByPlan', 'br.field.reason', 'br.form.checking', 'br.form.saveDraft',
    'br.form.review.lede', 'br.form.review.diff', 'br.form.review.col.field', 'br.form.review.col.before', 'br.form.review.col.after', 'br.form.review.noDiff',
    'br.form.review.contrastWarn', 'br.form.submit', 'br.form.submitting', 'br.form.backToEdit', 'br.form.success.title', 'br.form.success.body',
    'br.form.success.audit', 'br.form.viewAudit', 'br.form.backToScreen', 'br.form.failure.title', 'br.form.failure.untouched', 'br.form.failure.retry',
    'br.contrast.title', 'br.contrast.passed', 'br.contrast.blocked', 'br.contrast.aaPass', 'br.contrast.aaFail', 'br.contrast.aaaLargePass',
    'br.contrast.aaaLargeFail', 'br.contrast.aaaPass', 'br.contrast.aaaNeeds', 'br.contrast.law', 'br.contrast.senior',
    'br.preview.title', 'br.preview.note', 'br.preview.desktop', 'br.preview.app', 'br.preview.print', 'br.preview.printNote', 'br.preview.poweredBy',
    ...PAIRS.map((p) => `br.pair.${p}`),
    ...DRAFT_FIELDS.map((f) => `br.diffField.${f}`), 'br.diffField.logoMediaId',
    ...BRAND_REFUSAL_CODES.map((c) => `br.refusal.${c}`),
  ];
}
