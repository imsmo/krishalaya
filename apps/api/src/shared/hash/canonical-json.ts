// shared/hash/canonical-json.ts · PC-56 STORE-5b · B11 (founder D3, survey F-9) — ONE JSON TEXT FOR ONE VALUE. PURE.
//
// The trace chain hashed `JSON.stringify(meta)` as the API happened to hold it; the meta is then stored as jsonb, which re-orders keys
// (length first, then bytes) — so recomputing the hash from the STORED row gave another text for any multi-key meta, and nobody could check
// the chain. A hash is only checkable over a text everyone can rebuild from the value alone. The canonical text:
//   • object keys SORTED at every depth (JavaScript's default order — UTF-16 code units, the same order `Array.prototype.sort()` gives);
//   • NO whitespace anywhere;
//   • numbers as JSON prints them (`JSON.stringify(25)` → `25`, `2.5` → `2.5`; a non-finite number → `null`, as JSON does);
//   • strings escaped exactly as JSON escapes them (`JSON.stringify`);
//   • `true` / `false` / `null`; an `undefined` member is left out (as JSON does), an `undefined` array element is `null` (as JSON does);
//   • a value with `toJSON` (a Date) is canonicalised through it, as JSON does.
// The vectors in `__fixtures__/canonical-json.vectors.json` are read by this module's spec AND by the storefront's `store5b-trace.spec.ts`
// (the parity precedent of trace-meta.spec.ts): the page prints the formula, and the formula's text is this one.
export function canonicalJson(value: unknown): string {
  const v = value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function'
    ? (value as { toJSON: () => unknown }).toJSON() : value;
  if (v === undefined) return 'null';
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : 'null';
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined || typeof x === 'function' ? 'null' : canonicalJson(x))).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined && typeof o[k] !== 'function').sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return 'null';
}
