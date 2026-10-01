// modules/cms/dto/update-cms-page.dto.ts · PC-56 TENANT-8c · `PATCH /cms/pages/:id` (the SDK's `pages.update`) is the
// form write aimed at ONE draft: the same body as the form (`PageFormSchema`), the same review, and the writer refuses
// (409 CMS_PAGE_CHANGED) when that id is not the slug's open draft any more. Kept as its own name for the route.
export { PageFormSchema as UpdatePageSchema } from './create-cms-page.dto';
export type { PageFormDto as UpdatePageDto } from './create-cms-page.dto';
