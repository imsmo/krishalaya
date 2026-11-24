// modules/catalogue/__tests__/eav.spec.ts · UNIT suite for the EAV/brands read engine (pure / no I/O).
// Proves the entity invariants (template payload validation + clone ordering, category-attribute conditional
// logic, brand/option read models) and the .strict() DTO contracts (incl. the global write-shapes single-sourced
// here). Integration coverage (real Postgres + RLS shared-read) lives in catalogue.integration.spec.ts.
import { Brand } from '../domain/brand.entity';
import { AttributeOption } from '../domain/attribute-option.entity';
import { AttributeTemplate } from '../domain/attribute-template.entity';
import { CategoryAttribute } from '../domain/category-attribute.entity';
import { AttributeTemplateInvalidError } from '../domain/catalogue.errors';
import { CreateAttributeDefinitionSchema } from '../dto/create-attribute-definition.dto';
import { CreateAttributeOptionSchema } from '../dto/create-attribute-option.dto';
import { CreateAttributeTemplateSchema } from '../dto/create-attribute-template.dto';
import { CreateCategoryAttributeSchema } from '../dto/create-category-attribute.dto';
import { CreateCategorySchema } from '../dto/create-category.dto';
import { QueryAttributeTemplateSchema } from '../dto/query-attribute-template.dto';
import { QueryBrandSchema } from '../dto/query-brand.dto';

// PC-56 SEC-4 (zod 4): `.uuid()` checks the RFC version/variant digits, so fixtures are real v4-shaped ids (still one per n).
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

describe('Brand / AttributeOption entities (read models)', () => {
  it('Brand.toJSON exposes name/manufacturer/verified', () => {
    const b = new Brand({ id: U(1), defaultName: 'Mahindra', manufacturer: 'M&M', isVerified: true });
    expect(b.toJSON()).toMatchObject({ defaultName: 'Mahindra', manufacturer: 'M&M', isVerified: true });
  });
  it('AttributeOption.toJSON carries attribute + code + sort', () => {
    const o = new AttributeOption({ id: U(2), attributeId: U(3), code: 'hd2967', defaultName: 'HD-2967', sortOrder: 10, isActive: true });
    expect(o.toJSON()).toMatchObject({ attributeId: U(3), code: 'hd2967', sortOrder: 10 });
  });
});

describe('AttributeTemplate.resolveItems', () => {
  const tpl = (payload: unknown) => new AttributeTemplate({ id: U(4), code: 'wheat_standard', defaultName: 'Wheat', categoryId: null, payload });
  it('normalises + sorts items by sortOrder', () => {
    const t = tpl({ items: [{ attributeId: U(5), sortOrder: 20 }, { attributeId: U(6), required: true, sortOrder: 10, defaultValue: 'faq' }] });
    const items = t.resolveItems();
    expect(items[0].attributeId).toBe(U(6));   // sortOrder 10 first
    expect(items[0].required).toBe(true);
    expect(items[0].defaultValue).toBe('faq');
    expect(items[1].sortOrder).toBe(20);
  });
  it('rejects a malformed payload (→422, never a 500)', () => {
    expect(() => tpl({}).resolveItems()).toThrow(AttributeTemplateInvalidError);
    expect(() => tpl({ items: 'nope' }).resolveItems()).toThrow(AttributeTemplateInvalidError);
    expect(() => tpl({ items: [{ attributeId: 'not-a-uuid' }] }).resolveItems()).toThrow(AttributeTemplateInvalidError);
    expect(() => tpl({ items: new Array(201).fill({ attributeId: U(5) }) }).resolveItems()).toThrow(AttributeTemplateInvalidError);
  });
});

describe('CategoryAttribute conditional logic', () => {
  const make = (condition: unknown) => new CategoryAttribute({ id: U(7), categoryId: U(8), attributeId: U(9), isRequired: false, showInFilters: true, showOnCard: false, condition, sortOrder: 100 });
  it('no condition ⇒ always applies, no extra required', () => {
    const ca = make(null);
    expect(ca.appliesWhen({})).toBe(true);
    expect(ca.conditionalRequired({})).toEqual([]);
  });
  it('matching if-clause ⇒ applies + surfaces then.required', () => {
    const ca = make({ if: { organic: true }, then: { required: ['cert_body', 'cert_no'] } });
    expect(ca.appliesWhen({ organic: true })).toBe(true);
    expect(ca.conditionalRequired({ organic: true })).toEqual(['cert_body', 'cert_no']);
    expect(ca.appliesWhen({ organic: false })).toBe(false);
    expect(ca.conditionalRequired({ organic: false })).toEqual([]);
  });
});

describe('DTO .strict() contracts', () => {
  it('create-attribute-definition: enum dataType + code regex + rejects unknown keys', () => {
    expect(CreateAttributeDefinitionSchema.safeParse({ code: 'moisture_pct', defaultName: 'Moisture %', dataType: 'number', validation: { min: 0, max: 100 } }).success).toBe(true);
    expect(CreateAttributeDefinitionSchema.safeParse({ code: 'Bad Code', defaultName: 'x', dataType: 'number' }).success).toBe(false);
    expect(CreateAttributeDefinitionSchema.safeParse({ code: 'ok', defaultName: 'x', dataType: 'weird' }).success).toBe(false);
    expect(CreateAttributeDefinitionSchema.safeParse({ code: 'ok', defaultName: 'x', dataType: 'text', evil: 1 }).success).toBe(false);
  });
  it('create-attribute-option / category-attribute / category shapes', () => {
    expect(CreateAttributeOptionSchema.safeParse({ attributeId: U(1), code: 'faq', defaultName: 'FAQ' }).success).toBe(true);
    expect(CreateCategoryAttributeSchema.safeParse({ categoryId: U(1), attributeId: U(2) }).success).toBe(true);
    expect(CreateCategorySchema.safeParse({ slug: 'wheat', defaultName: 'Wheat' }).success).toBe(true);
    expect(CreateCategorySchema.safeParse({ slug: 'WHEAT', defaultName: 'Wheat' }).success).toBe(false);
  });
  it('create-attribute-template validates the payload.items shape + cap', () => {
    expect(CreateAttributeTemplateSchema.safeParse({ code: 'wheat_standard', defaultName: 'Wheat', payload: { items: [{ attributeId: U(1), required: true }] } }).success).toBe(true);
    expect(CreateAttributeTemplateSchema.safeParse({ code: 'wheat_standard', defaultName: 'Wheat', payload: { items: [{ attributeId: 'no' }] } }).success).toBe(false);
  });
  it('query DTOs: keyset limit caps + strict', () => {
    expect(QueryAttributeTemplateSchema.safeParse({ limit: 50 }).success).toBe(true);
    expect(QueryAttributeTemplateSchema.safeParse({ limit: 9999 }).success).toBe(false);
    expect(QueryBrandSchema.safeParse({ verifiedOnly: true }).success).toBe(true);
    expect(QueryBrandSchema.safeParse({ junk: 1 }).success).toBe(false);
  });
});
