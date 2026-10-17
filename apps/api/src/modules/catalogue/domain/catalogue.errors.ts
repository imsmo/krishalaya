// modules/catalogue/domain/catalogue.errors.ts · typed errors, stable codes → HTTP.
import { DomainError } from '../../../shared/errors/app-error';
export class CategoryNotFoundError extends DomainError { constructor(ref: string) { super('CATEGORY_NOT_FOUND', `Category ${ref} not found`, 404); } }
export class ProductNotFoundError extends DomainError { constructor(id: string) { super('PRODUCT_NOT_FOUND', `Product ${id} not found`, 404); } }
export class BatchNotFoundError extends DomainError { constructor(id: string) { super('BATCH_NOT_FOUND', `Batch ${id} not found`, 404); } }
export class InvalidProductError extends DomainError { constructor(reason: string) { super('PRODUCT_INVALID', reason, 422); } }
export class InvalidBatchError extends DomainError { constructor(reason: string) { super('BATCH_INVALID', reason, 422); } }
export class InsufficientBatchQtyError extends DomainError { constructor(requested: number, available: number) { super('BATCH_INSUFFICIENT_QTY', `Requested ${requested} exceeds remaining ${available}`, 409, { requested, available }); } }
export class ProductConcurrencyError extends DomainError { constructor(id: string) { super('PRODUCT_CONCURRENCY_CONFLICT', `Product ${id} was modified concurrently; retry`, 409); } }
export class AttributeValidationError extends DomainError { constructor(attr: string, reason: string) { super('ATTRIBUTE_INVALID', `Attribute ${attr}: ${reason}`, 422, { attr }); } }
export class BrandNotFoundError extends DomainError { constructor(id: string) { super('BRAND_NOT_FOUND', `Brand ${id} not found`, 404); } }
export class AttributeTemplateNotFoundError extends DomainError { constructor(ref: string) { super('ATTRIBUTE_TEMPLATE_NOT_FOUND', `Attribute template ${ref} not found`, 404); } }
export class AttributeTemplateInvalidError extends DomainError { constructor(code: string, reason: string) { super('ATTRIBUTE_TEMPLATE_INVALID', `Attribute template ${code}: ${reason}`, 422, { code }); } }
export class CertificateNotFoundError extends DomainError { constructor(id: string) { super('CERTIFICATE_NOT_FOUND', `Certificate ${id} not found`, 404); } }
export class InvalidCertificateError extends DomainError { constructor(reason: string) { super('CERTIFICATE_INVALID', reason, 422); } }
export class IllegalCertificateTransitionError extends DomainError { constructor(from: string, to: string) { super('CERTIFICATE_ILLEGAL_TRANSITION', `Certificate cannot move ${from} → ${to}`, 409, { from, to }); } }
/** PC-56 STORE-5b · B17 (survey C-9): `certTypeId` must be an active value of the `cert_type` vocabulary (0219 seeds the seven platform types). */
export class CertificateTypeUnknownError extends DomainError { constructor() { super('CERTIFICATE_TYPE_UNKNOWN', 'certTypeId is not a certificate type', 422); } }
/** PC-56 STORE-5b · D1: the organisation has not published its certificates (`certificates_public` OFF — platform-wide or for it). A NAMED reason,
 *  distinct from CERTIFICATE_NOT_FOUND: OFF is not "not found". */
export class CertificateNotPublishedError extends DomainError { constructor() { super('CERTIFICATE_NOT_PUBLISHED', 'This organisation has not published its certificates', 404); } }
