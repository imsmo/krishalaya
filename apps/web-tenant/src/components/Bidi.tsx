// apps/web-tenant/src/components/Bidi.tsx · PC-56 RTL-1b-1 · bidi isolation for the Arabic machine draft (canon
// lang-ar/W128: `.bidi{direction:ltr;unicode-bidi:isolate}` on every money cell, masked phone, file name, code and ID).
//
// WHY: inside a right-to-left page a left-to-right run such as "₹1,23,456.50 / kg", "LST-2026-088417" or a file hash
// is split at its neutral characters (`, . / - •`) and reordered — the amount can read wrong. `<bdi dir="ltr">` isolates
// the run so the browser lays it out left to right as one unit, whatever surrounds it. Under en/hi/gu (ltr pages) the
// isolate changes nothing visible ("harmlessly isolated otherwise" — the RTL-1b brief).
//
// MONEY SHAPE (founder Q4 "Western digits" + the lead's money shape, 07_RTL.md "RTL-1 SPLIT"): on an Arabic page every
// amount is printed in the INDIAN shape — en-IN, "₹1,23,456.50", symbol first, lakh grouping — exactly as the canon page
// shows it, not the Arabic locale's own "123,456.50 ₹". Every other language keeps its own formatter locale, unchanged.
// The amount itself is untouched (Law 2: `formatMoneyMinor` keeps bigint minor-unit strings).
//
// No hooks, no server-only imports: usable from server pages and from the client `ListingsTable` alike.
import * as React from 'react';
import { formatMoneyMinor, PREVIEW_LANGUAGES } from '@krishalaya/i18n';

/** The formatter language for an amount: a preview language (Arabic) prints money in the Indian shape (en → en-IN). */
export function moneyLang(lang: string): string {
  return PREVIEW_LANGUAGES.includes(lang) ? 'en' : lang;
}

/** One money amount, isolated left-to-right. */
export function Money({ minor, currency, lang }: { minor: string | bigint; currency: string; lang: string }) {
  return <bdi dir="ltr" className="kv-money">{formatMoneyMinor(minor, currency, moneyLang(lang))}</bdi>;
}

/** A code, ID, file name, hash or phone number, isolated left-to-right (never translated, never mirrored). */
export function Ltr({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

/** Interpolates React nodes into a catalogue template: `rich(t.t('limport.hash'), { hash: <Ltr>…</Ltr> })`. The
 *  Translator leaves an unsupplied `{name}` in place, so `t.t(key)` with no vars IS the template. A token with no node
 *  stays literal, exactly as `Translator.t` would print it. */
export function rich(template: string, nodes: Record<string, React.ReactNode>): React.ReactNode[] {
  return template.split(/(\{\w+\})/g).filter((part) => part !== '').map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return <React.Fragment key={i}>{m && m[1] in nodes ? nodes[m[1]] : part}</React.Fragment>;
  });
}
