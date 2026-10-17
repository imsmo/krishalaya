// shared/hash/__tests__/canonical-json.spec.ts · PC-56 STORE-5b · B11 — the canonical text, against the SHARED vectors (written by an independent
// implementation; the storefront's store5b-trace.spec.ts reads the same file).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson } from '../canonical-json';

const V = JSON.parse(readFileSync(join(__dirname, '..', '__fixtures__', 'canonical-json.vectors.json'), 'utf8')) as {
  canonical: Array<{ name: string; value: unknown; canonical: string }>;
};

describe('STORE-5b · canonicalJson', () => {
  it.each(V.canonical.map((c) => [c.name, c.value, c.canonical] as const))('vector: %s', (_n, value, expected) => {
    expect(canonicalJson(value)).toBe(expected);
  });
  it('key order never changes the text; whitespace never appears; nested keys sort too', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
    expect(canonicalJson({ a: [1, { y: 1, x: 2 }] })).toBe('{"a":[1,{"x":2,"y":1}]}');
    expect(canonicalJson({ a: 'x y' })).not.toMatch(/\s(?![y])/);
  });
  it('undefined members are left out and undefined array elements are null — as JSON does; non-finite numbers are null; a Date goes through toJSON', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([undefined, 1])).toBe('[null,1]');
    expect(canonicalJson({ n: Number.NaN, i: Infinity })).toBe('{"i":null,"n":null}');
    expect(canonicalJson({ d: new Date('2026-10-17T00:00:00.000Z') })).toBe('{"d":"2026-10-17T00:00:00.000Z"}');
    expect(canonicalJson(null)).toBe('null');
  });
});
