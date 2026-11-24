// apps/web-storefront/src/features/legal/markdown.ts · PC-56 LEGAL-1 — A SMALL, SAFE MARKDOWN READER for the four policy pages. PURE (no React,
// no IO, no dependency).
//
// The policy bodies (`storefront.policy()`) are markdown written in the admin realm. They are NEVER handed to the browser as HTML: this module turns
// the text into a tiny tree (blocks → inline nodes) and components/legal/PolicyBody.tsx renders that tree as React elements (no
// dangerouslySetInnerHTML anywhere). What is understood, and nothing else:
//   • `#` / `##` → h2 (the page's h1 is the policy's title), `###` → h3, `####`–`######` → h4 — each with a slug id (deduplicated) so
//     `/terms#cancellations`-style anchors land;
//   • paragraphs (consecutive lines joined by a space), `---` / `***` / `___` rules;
//   • single-level lists: `- ` / `* ` unordered, `1. ` / `1) ` ordered (an indented line continues the item);
//   • inline: `**bold**`, `*italic*` / `_italic_` (an `_` inside a word is a letter, never emphasis), `\` escapes, `[text](href)` links.
// LINKS: the href must be http(s) (an external link — rendered with rel="noopener noreferrer"), `mailto:`, or a same-site path starting with `/`
// (not `//`) or `#`. Anything else — `javascript:` in any case, `data:`, `vbscript:`, `//host`, other schemes, any whitespace / control
// character / backslash inside the href (`java\tscript:`) — keeps the link TEXT and drops the link. Allow-list, never a deny-list.
// RAW HTML is never interpreted: `<script>` is just characters in a text node (React escapes them).
// TOKENS `{{ name }}` are kept intact as text (their underscores are never emphasis) — tokens.ts substitutes them AFTER parsing, on text nodes.
// BOUNDED: the input is capped at MAX_MARKDOWN_CHARS; every closing-marker search is an O(1) lookup into a table built in one right-to-left pass,
// and a link target's balanced `)` comes from one stack pass, so a line is read in linear time (no backtracking regex), and emphasis nests at most MAX_DEPTH deep.

export const MAX_MARKDOWN_CHARS = 200_000;
const MAX_DEPTH = 4;
const MAX_HREF = 2048;
const MAX_TOKEN = 120;

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; external: boolean; c: Inline[] };

export type Block =
  | { t: 'heading'; level: 2 | 3 | 4; id: string; c: Inline[] }
  | { t: 'paragraph'; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { t: 'rule' };

export type MarkdownDoc = { blocks: Block[]; truncated: boolean };

/** A link target as rendered, or null (= print the link text only). */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const h = String(raw ?? '').replace(/^ +| +$/g, '');
  if (h.length === 0 || h.length > MAX_HREF) return null;
  // any whitespace (incl. Unicode spaces), control character or backslash anywhere: refused (browsers strip `\t` / `\n` inside a scheme, and
  // read `/\host` as `//host`)
  for (const ch of h) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x20 || (c >= 0x7f && c <= 0x9f) || ch === '\\' || /\s/u.test(ch) || c === 0x200b || c === 0x200c || c === 0x200d || c === 0xfeff) return null;
  }
  if (h.startsWith('#')) return { href: h, external: false };
  if (h.startsWith('/')) return h.startsWith('//') ? null : { href: h, external: false };
  const lower = h.toLowerCase();
  if (lower.startsWith('mailto:')) return h.length > 7 ? { href: h, external: false } : null;
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    try {
      const u = new URL(h);
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
      return { href: h, external: true };
    } catch {
      return null;
    }
  }
  return null;
}

/** A heading's anchor id: letters (any script) and digits, runs of anything else → `-`, at most 64 characters; '' when nothing is left. */
export function slugify(s: string): string {
  const out = s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').slice(0, 64);
  return out.replace(/^-+/, '').replace(/-+$/, '');
}

/** The plain text of inline nodes (for ids and tests). */
export function plainText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.v : plainText(n.c))).join('');
}

const PUNCT = new Set('\\`*_{}[]()#+-.!|<>~"\'');
const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{M}\p{N}]/u.test(ch);
const isSpace = (ch: string | undefined) => ch === undefined || ch === ' ' || ch === '\t' || ch === '\n';

/** next[i] = the smallest j ≥ i where `ok(j)` holds, else -1 — one right-to-left pass. */
function nextTable(n: number, ok: (j: number) => boolean): Int32Array {
  const t = new Int32Array(n + 1);
  t[n] = -1;
  for (let j = n - 1; j >= 0; j--) t[j] = ok(j) ? j : t[j + 1];
  return t;
}

function parseInline(s: string, depth: number, allowLinks: boolean): Inline[] {
  const n = s.length;
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  if (depth > MAX_DEPTH) return n ? [{ t: 'text', v: s }] : [];
  const escaped = (j: number) => { let k = j - 1, b = 0; while (k >= 0 && s[k] === '\\') { b++; k--; } return b % 2 === 1; };
  // closers, each looked up in O(1)
  const strongClose = nextTable(n, (j) => s[j] === '*' && s[j + 1] === '*' && !escaped(j) && !isSpace(s[j - 1]));
  const starClose = nextTable(n, (j) => s[j] === '*' && s[j - 1] !== '*' && s[j + 1] !== '*' && !escaped(j) && !isSpace(s[j - 1]));
  const underClose = nextTable(n, (j) => s[j] === '_' && !escaped(j) && !isSpace(s[j - 1]) && !isWordChar(s[j + 1]));
  const bracketClose = nextTable(n, (j) => s[j] === ']' && !escaped(j));
  // a link target's `(` → its BALANCED `)` (so `javascript:alert(1)` is read whole), one stack pass
  const parenMatch = new Int32Array(n).fill(-1);
  { const stack: number[] = []; for (let j = 0; j < n; j++) { if (s[j] === '(') stack.push(j); else if (s[j] === ')' && stack.length) parenMatch[stack.pop()!] = j; } }
  const braceClose = nextTable(n, (j) => s[j] === '}' && s[j + 1] === '}');
  const at = (t: Int32Array, from: number) => (from <= n ? t[from] : -1);

  let i = 0;
  while (i < n) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < n && PUNCT.has(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    if (ch === '{' && s[i + 1] === '{') {
      // a token is kept whole (its `_` never opens emphasis); tokens.ts reads it later
      const j = at(braceClose, i + 2);
      if (j !== -1 && j - i <= MAX_TOKEN && !s.slice(i, j).includes('\n')) { buf += s.slice(i, j + 2); i = j + 2; continue; }
      buf += ch; i++; continue;
    }
    if (ch === '*' && s[i + 1] === '*' && !isSpace(s[i + 2])) {
      const j = at(strongClose, i + 3);
      if (j !== -1) { flush(); out.push({ t: 'strong', c: parseInline(s.slice(i + 2, j), depth + 1, allowLinks) }); i = j + 2; continue; }
      buf += '**'; i += 2; continue;
    }
    if (ch === '*' && s[i + 1] !== '*' && !isSpace(s[i + 1])) {
      const j = at(starClose, i + 2);
      if (j !== -1) { flush(); out.push({ t: 'em', c: parseInline(s.slice(i + 1, j), depth + 1, allowLinks) }); i = j + 1; continue; }
    }
    if (ch === '_' && !isWordChar(s[i - 1]) && !isSpace(s[i + 1]) && s[i + 1] !== '_') {
      const j = at(underClose, i + 2);
      if (j !== -1) { flush(); out.push({ t: 'em', c: parseInline(s.slice(i + 1, j), depth + 1, allowLinks) }); i = j + 1; continue; }
    }
    if (ch === '[' && allowLinks) {
      const j = at(bracketClose, i + 1);
      if (j !== -1 && s[j + 1] === '(') {
        const k = parenMatch[j + 1];
        if (k !== -1) {
          const label = parseInline(s.slice(i + 1, j), depth + 1, false);
          const target = safeHref(s.slice(j + 2, k));
          flush();
          if (target) out.push({ t: 'link', href: target.href, external: target.external, c: label });
          else out.push(...label);   // an unsafe target: the text only, never an anchor
          i = k + 1; continue;
        }
      }
    }
    buf += ch; i++;
  }
  flush();
  // merge adjacent text nodes (an unsafe link's label spills text)
  const merged: Inline[] = [];
  for (const x of out) {
    const last = merged[merged.length - 1];
    if (x.t === 'text' && last && last.t === 'text') merged[merged.length - 1] = { t: 'text', v: last.v + x.v };
    else merged.push(x);
  }
  return merged;
}

/** One line's inline content. */
export function parseInlineText(s: string): Inline[] {
  return parseInline(s, 0, true);
}

const UL = /^[-*+][ \t]+/;
const OL = /^(\d{1,9})[.)][ \t]+/;
function isRule(line: string): boolean {
  const s = line.replace(/[ \t]/g, '');
  return s.length >= 3 && (/^-+$/.test(s) || /^\*+$/.test(s) || /^_+$/.test(s));
}
function headingOf(line: string): { level: 2 | 3 | 4; text: string } | null {
  let k = 0;
  while (k < line.length && k < 7 && line[k] === '#') k++;
  if (k === 0 || k > 6) return null;
  if (k < line.length && line[k] !== ' ' && line[k] !== '\t') return null;
  let text = line.slice(k).trim();
  // an optional closing run of `#` (preceded by a space)
  let e = text.length;
  while (e > 0 && text[e - 1] === '#') e--;
  if (e < text.length && (e === 0 || text[e - 1] === ' ')) text = text.slice(0, e).trim();
  return { level: k <= 2 ? 2 : k === 3 ? 3 : 4, text };
}

/** Markdown → blocks. Never throws; an over-long input is cut at MAX_MARKDOWN_CHARS (`truncated: true` — the page says so). */
export function parseMarkdown(src: string): MarkdownDoc {
  let text = typeof src === 'string' ? src : '';
  const truncated = text.length > MAX_MARKDOWN_CHARS;
  if (truncated) text = text.slice(0, MAX_MARKDOWN_CHARS);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const ids = new Map<string, number>();
  let para: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  const endPara = () => { if (para.length) { blocks.push({ t: 'paragraph', c: parseInlineText(para.join(' ')) }); para = []; } };
  const endList = () => { if (list) { blocks.push({ t: 'list', ordered: list.ordered, start: list.start, items: list.items.map(parseInlineText) }); list = null; } };
  const idFor = (raw: string) => {
    const base = slugify(raw) || 'section';
    const seen = ids.get(base) ?? 0;
    ids.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '    ');
    const trimmed = line.trim();
    if (trimmed === '') { endPara(); endList(); continue; }
    const indented = /^ {2,}/.test(line);
    const h = indented ? null : headingOf(trimmed);
    if (h) {
      endPara(); endList();
      const c = parseInlineText(h.text);
      blocks.push({ t: 'heading', level: h.level, id: idFor(plainText(c)), c });
      continue;
    }
    if (!indented && isRule(trimmed)) { endPara(); endList(); blocks.push({ t: 'rule' }); continue; }
    const ul = UL.exec(trimmed);
    const ol = ul ? null : OL.exec(trimmed);
    if ((ul || ol) && !(indented && list)) {
      endPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) endList();
      if (!list) list = { ordered, start: ol ? Math.min(Number(ol[1]), 999_999_999) : 1, items: [] };
      list.items.push(trimmed.slice((ul ?? ol)![0].length));
      continue;
    }
    if (list && indented) { list.items[list.items.length - 1] += ` ${trimmed}`; continue; }
    endList();
    para.push(trimmed);
  }
  endPara(); endList();
  return { blocks, truncated };
}
