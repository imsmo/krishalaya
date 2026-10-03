// modules/tenancy/domain/logo-rules.ts · PC-56 TENANT-13d · A3 — THE LOGO RULES (pure; no I/O, no dependency).
//
// Canon W191: "anand_logo.svg · SVG/PNG · used on app, statements, invoices". Brief A3: SVG or PNG, ≤ 512 KB, square or wide; SVG
// SANITISED (scripts and foreign objects); served from the media store with a content-type lock.
//
// The repository has no SVG sanitiser and apps/api depends on no XML parser, so this is a STRICT ALLOW-LIST tokenizer written for one
// job: it re-emits only elements and attributes it knows to be inert. Two outcomes, never a third:
//   • REFUSED, by name, listing what was found — anything that can run or fetch: <script>, <foreignObject>, <iframe>/<object>/<embed>,
//     <image> (an external or data: raster), <a>, animation elements (they can rewrite href), event handlers (on*), javascript:/data:
//     URLs, external references (href / url() to anything but #id), a DOCTYPE or ENTITY (entity expansion), CDATA, processing
//     instructions, CSS @import / url() / expression();
//   • ACCEPTED, with the harmless rest STRIPPED — comments, <metadata>, editor namespaces (sodipodi/inkscape/sketch/illustrator
//     attributes and elements), unknown presentation attributes — and the output is the re-serialised allow-listed tree.
// A PNG is checked by its signature, its IHDR (width, height) and its chunk framing; anything else is refused.

export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_MIN_SIDE_PX = 32;
export const LOGO_MAX_ASPECT = 8;   // "square or wide": width ≥ height, and no wider than 8:1 (a hairline is not a logo)
export type LogoMime = 'image/png' | 'image/svg+xml';
export const LOGO_MIMES: readonly LogoMime[] = ['image/png', 'image/svg+xml'];

export type LogoVerdict =
  | { ok: true; mime: LogoMime; bytes: Buffer; width: number; height: number; stripped: string[] }
  | { ok: false; code: LogoRefusalCode; detail: Record<string, unknown> };
export type LogoRefusalCode =
  | 'LOGO_TOO_LARGE' | 'LOGO_EMPTY' | 'LOGO_TYPE_UNSUPPORTED' | 'LOGO_MALFORMED' | 'LOGO_SVG_UNSAFE' | 'LOGO_NOT_SQUARE_OR_WIDE' | 'LOGO_TOO_SMALL'
  | 'LOGO_NO_DIMENSIONS';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Judge an uploaded logo. `declaredMime` is the request's Content-Type; the bytes decide, and they must agree with it. */
export function judgeLogo(bytes: Buffer, declaredMime: string): LogoVerdict {
  if (bytes.length === 0) return { ok: false, code: 'LOGO_EMPTY', detail: {} };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, code: 'LOGO_TOO_LARGE', detail: { bytes: bytes.length, max: LOGO_MAX_BYTES } };
  const mime = String(declaredMime ?? '').split(';')[0].trim().toLowerCase();
  if (mime === 'image/png') return judgePng(bytes);
  if (mime === 'image/svg+xml') return judgeSvg(bytes);
  return { ok: false, code: 'LOGO_TYPE_UNSUPPORTED', detail: { mime, allowed: LOGO_MIMES } };
}

function shape(width: number, height: number): { code: LogoRefusalCode; detail: Record<string, unknown> } | null {
  if (!(width > 0) || !(height > 0)) return { code: 'LOGO_NO_DIMENSIONS', detail: {} };
  if (width < height) return { code: 'LOGO_NOT_SQUARE_OR_WIDE', detail: { width, height } };
  if (width / height > LOGO_MAX_ASPECT) return { code: 'LOGO_NOT_SQUARE_OR_WIDE', detail: { width, height, maxAspect: LOGO_MAX_ASPECT } };
  return null;
}

/* ================================================================================================================== */
/* PNG                                                                                                                */
/* ================================================================================================================== */

export function judgePng(b: Buffer): LogoVerdict {
  if (b.length < 33 || !b.subarray(0, 8).equals(PNG_SIG)) return { ok: false, code: 'LOGO_MALFORMED', detail: { expected: 'png_signature' } };
  // chunk framing: length(4) type(4) data(length) crc(4), first chunk IHDR, last IEND
  let off = 8; let first = true; let sawEnd = false; let width = 0; let height = 0;
  while (off + 12 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('latin1', off + 4, off + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || off + 12 + len > b.length) return { ok: false, code: 'LOGO_MALFORMED', detail: { at: off } };
    if (first) {
      if (type !== 'IHDR' || len !== 13) return { ok: false, code: 'LOGO_MALFORMED', detail: { expected: 'IHDR' } };
      width = b.readUInt32BE(off + 8); height = b.readUInt32BE(off + 12);
      first = false;
    }
    off += 12 + len;
    if (type === 'IEND') { sawEnd = true; break; }
  }
  if (!sawEnd) return { ok: false, code: 'LOGO_MALFORMED', detail: { expected: 'IEND' } };
  const s = shape(width, height);
  if (s) return { ok: false, ...s };
  if (height < LOGO_MIN_SIDE_PX) return { ok: false, code: 'LOGO_TOO_SMALL', detail: { width, height, minSide: LOGO_MIN_SIDE_PX } };
  // bytes after IEND are not part of the image (a classic polyglot carrier) — they are dropped
  return { ok: true, mime: 'image/png', bytes: Buffer.from(b.subarray(0, off)), width, height, stripped: off < b.length ? ['trailing_bytes'] : [] };
}

/* ================================================================================================================== */
/* SVG — the strict allow-list                                                                                        */
/* ================================================================================================================== */

const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient',
  'radialgradient', 'stop', 'title', 'desc', 'clippath', 'mask', 'use', 'symbol', 'style',
]);
/** elements that can run code, fetch, or rewrite references — their presence refuses the file */
const DANGEROUS_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed', 'image', 'a', 'animate', 'animatemotion', 'animatetransform', 'set',
  'handler', 'listener', 'feimage', 'audio', 'video', 'canvas', 'link', 'meta', 'base',
]);
const ALLOWED_ATTRS = new Set([
  'id', 'class', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'viewbox', 'points',
  'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'offset', 'stop-color', 'stop-opacity', 'gradientunits',
  'gradienttransform', 'spreadmethod', 'clip-path', 'clip-rule', 'clippathunits', 'mask', 'maskunits', 'maskcontentunits',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'xmlns', 'xmlns:xlink',
  'version', 'preserveaspectratio', 'style', 'href', 'xlink:href', 'xml:space', 'display', 'visibility', 'color', 'dx', 'dy',
  'vector-effect', 'paint-order', 'shape-rendering', 'text-rendering', 'type', 'media', 'role', 'aria-label', 'aria-hidden', 'focusable',
]);
const REF_ATTRS = new Set(['href', 'xlink:href']);

export interface SvgSanitised { svg: string; width: number; height: number; stripped: string[] }

/** Tokenize, refuse anything dangerous, strip the harmless unknown, re-emit. Pure. */
export function sanitiseSvg(source: string): { ok: true; value: SvgSanitised } | { ok: false; code: LogoRefusalCode; detail: Record<string, unknown> } {
  const found = new Set<string>();
  const stripped = new Set<string>();
  const out: string[] = [];
  const stack: Array<{ name: string; keep: boolean }> = [];
  let i = 0; let root: { width: number; height: number } | null = null; let elements = 0;
  const s = source.replace(/^﻿/, '');
  if (s.includes('�')) return { ok: false, code: 'LOGO_MALFORMED', detail: { problem: 'encoding' } };
  if (/<!DOCTYPE|<!ENTITY/i.test(s)) found.add('doctype_or_entity');
  const keeping = () => stack.every((e) => e.keep);
  const malformed = (problem: string) => ({ ok: false as const, code: 'LOGO_MALFORMED' as const, detail: { problem, at: i } });

  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { const tail = s.slice(i); if (tail.trim() && keeping()) out.push(escText(tail)); break; }
    if (lt > i) { const text = s.slice(i, lt); if (keeping() && stack.length) out.push(escText(text)); else if (text.trim() && !stack.length) return malformed('text_outside_root'); }
    i = lt;
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4); if (end < 0) return malformed('comment'); stripped.add('comments'); i = end + 3; continue;
    }
    if (s.startsWith('<![CDATA[', i)) { found.add('cdata'); const end = s.indexOf(']]>', i); i = end < 0 ? s.length : end + 3; continue; }
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i); if (end < 0) return malformed('processing_instruction');
      const pi = s.slice(i + 2, end).trim().toLowerCase();
      if (!(pi.startsWith('xml ') || pi === 'xml') || out.length > 0) found.add('processing_instruction');
      i = end + 2; continue;
    }
    if (s.startsWith('<!', i)) {
      // a DOCTYPE (with or without an internal [ … ] subset of ENTITY declarations) — refused; skipped whole so the rest is still read
      found.add('doctype_or_entity');
      const gt = s.indexOf('>', i); const br = s.indexOf('[', i);
      const end = br >= 0 && (gt < 0 || br < gt) ? s.indexOf(']>', br) : gt;
      i = end < 0 ? s.length : end + (br >= 0 && (gt < 0 || br < gt) ? 2 : 1);
      continue;
    }
    if (s.startsWith('</', i)) {
      const end = s.indexOf('>', i); if (end < 0) return malformed('close_tag');
      const name = s.slice(i + 2, end).trim().toLowerCase();
      const top = stack.pop();
      if (!top || top.name !== name) return malformed('unbalanced');
      if (top.keep && keeping()) out.push(`</${outName(name)}>`);
      i = end + 1; continue;
    }
    // an opening tag
    const tag = readTag(s, i);
    if (!tag) return malformed('tag');
    i = tag.end;
    elements++;
    if (elements > 10_000 || stack.length > 64) return malformed('too_complex');
    const local = tag.name.toLowerCase();
    if (!stack.length && local !== 'svg') return malformed('root_not_svg');
    if (DANGEROUS_ELEMENTS.has(local)) found.add(`element:${local}`);
    const known = ALLOWED_ELEMENTS.has(local);
    if (!known && !DANGEROUS_ELEMENTS.has(local)) stripped.add(`element:${local}`);
    const keep = known && !DANGEROUS_ELEMENTS.has(local);
    const attrsOut: string[] = [];
    for (const a of tag.attrs) {
      const an = a.name.toLowerCase();
      const v = a.value;
      if (an.startsWith('on')) { found.add(`attribute:${an}`); continue; }
      if (/javascript:|vbscript:|data:/i.test(v.replace(/[\s\u0000-\u001f]/g, ''))) { found.add('script_or_data_url'); continue; }
      if (REF_ATTRS.has(an)) {
        if (!/^#[A-Za-z_][\w.-]*$/.test(v.trim())) { found.add('external_reference'); continue; }
      }
      if (hasForeignUrl(v)) { found.add('external_reference'); continue; }
      if (an === 'style' && /@import|expression\s*\(|behavior\s*:|-moz-binding/i.test(v)) { found.add('css_active_content'); continue; }
      if (!ALLOWED_ATTRS.has(an)) { stripped.add(`attribute:${an.includes(':') ? an.split(':')[0] + ':*' : an}`); continue; }
      attrsOut.push(` ${outAttrName(an)}="${escAttr(v)}"`);
    }
    if (local === 'svg' && !root) root = svgSize(tag.attrs);
    if (local === 'style' && !tag.selfClosing) {
      // a <style> element's text: no imports, no external url(), no expressions — checked here, re-emitted verbatim (no '<' possible)
      const close = s.toLowerCase().indexOf('</style', i);
      if (close < 0) return malformed('style');
      const css = s.slice(i, close);
      if (/@import|expression\s*\(|behavior\s*:|-moz-binding|javascript:/i.test(css)) found.add('css_active_content');
      if (hasForeignUrl(css)) found.add('external_reference');
      if (keep && keeping()) out.push(`<style${attrsOut.join('')}>${css.replace(/</g, '')}</style>`);
      const end = s.indexOf('>', close); if (end < 0) return malformed('style');
      i = end + 1; continue;
    }
    if (keep && keeping()) out.push(`<${outName(local)}${attrsOut.join('')}${tag.selfClosing ? '/>' : '>'}`);
    if (!tag.selfClosing) stack.push({ name: local, keep });
  }
  if (stack.length) return malformed('unclosed');
  if (found.size) return { ok: false, code: 'LOGO_SVG_UNSAFE', detail: { found: [...found].sort() } };
  if (!root) return { ok: false, code: 'LOGO_NO_DIMENSIONS', detail: {} };
  return { ok: true, value: { svg: out.join(''), width: root.width, height: root.height, stripped: [...stripped].sort() } };
}

export function judgeSvg(b: Buffer): LogoVerdict {
  const r = sanitiseSvg(b.toString('utf8'));
  if (!r.ok) return r;
  const sh = shape(r.value.width, r.value.height);
  if (sh) return { ok: false, ...sh };
  return { ok: true, mime: 'image/svg+xml', bytes: Buffer.from(r.value.svg, 'utf8'), width: r.value.width, height: r.value.height, stripped: r.value.stripped };
}

/** Any `url(...)` whose target is not a same-document `#id` (a fetch, a data: URL, a file). */
export function hasForeignUrl(v: string): boolean {
  const re = /url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  let m: RegExpExecArray | null; let count = 0;
  while ((m = re.exec(v)) !== null) { count++; if (!/^#[A-Za-z_][\w.-]*$/.test(m[2].trim())) return true; }
  // an unterminated or oddly-written url( that the pattern did not match is refused as well
  return (v.match(/url\s*\(/gi)?.length ?? 0) !== count;
}

/* ---- tokenizer helpers -------------------------------------------------------------------------------------------- */

interface Tag { name: string; attrs: Array<{ name: string; value: string }>; selfClosing: boolean; end: number }

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[-A-Za-z0-9_:.]/;

function readTag(s: string, at: number): Tag | null {
  let i = at + 1;
  if (!NAME_START.test(s[i] ?? '')) return null;
  let name = '';
  while (i < s.length && NAME_CHAR.test(s[i])) name += s[i++];
  const attrs: Array<{ name: string; value: string }> = [];
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) return null;
    if (s[i] === '>') return { name, attrs, selfClosing: false, end: i + 1 };
    if (s[i] === '/' && s[i + 1] === '>') return { name, attrs, selfClosing: true, end: i + 2 };
    if (!NAME_START.test(s[i])) return null;
    let an = '';
    while (i < s.length && NAME_CHAR.test(s[i])) an += s[i++];
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== '=') return null;
    i++;
    while (i < s.length && /\s/.test(s[i])) i++;
    const q = s[i];
    if (q !== '"' && q !== "'") return null;
    const close = s.indexOf(q, i + 1);
    if (close < 0) return null;
    const raw = s.slice(i + 1, close);
    if (raw.includes('<')) return null;
    attrs.push({ name: an, value: decodeEntities(raw) });
    i = close + 1;
    if (attrs.length > 200) return null;
  }
}

/** Decode the five XML entities and numeric references — so `&#106;avascript:` is seen as what it is. */
function decodeEntities(v: string): string {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function safeChar(cp: number): string { return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''; }
function escAttr(v: string): string { return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escText(v: string): string {
  // text arrives still entity-encoded; keep known entities, escape any bare '&' or '>'
  return v.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/>/g, '&gt;');
}
const CASED: Record<string, string> = {
  lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath',
  viewbox: 'viewBox', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', spreadmethod: 'spreadMethod',
  clippathunits: 'clipPathUnits', maskunits: 'maskUnits', maskcontentunits: 'maskContentUnits', preserveaspectratio: 'preserveAspectRatio',
};
function outName(n: string): string { return CASED[n] ?? n; }
function outAttrName(n: string): string { return CASED[n] ?? n; }

function num(v: string | undefined): number {
  if (!v) return NaN;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(v);
  return m ? Number(m[1]) : NaN;
}
function svgSize(attrs: Array<{ name: string; value: string }>): { width: number; height: number } | null {
  const get = (n: string) => attrs.find((a) => a.name.toLowerCase() === n)?.value;
  const vb = get('viewbox');
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every((x) => Number.isFinite(x)) && p[2] > 0 && p[3] > 0) return { width: p[2], height: p[3] };
  }
  const w = num(get('width')), h = num(get('height'));
  if (w > 0 && h > 0) return { width: w, height: h };
  return null;
}
