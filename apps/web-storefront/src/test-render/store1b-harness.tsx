// apps/web-storefront/src/test-render/store1b-harness.tsx · PC-56 STORE-1b — shared helpers for the two homes' render tests (not a test file:
// jest.render.config.js matches *.render.test.tsx only).
//
// react-dom 18.3.1's server renderer cannot render an ASYNC server component, and the two layouts nest one (SiteHeader / TenantHeader read
// the cart count). `resolveTree` walks an element tree and replaces every element whose type is one of the NAMED async components with the
// tree that component resolves to — the same "await the async component for its element tree" seam STORE-1a's login test uses, applied
// to the children too. Only the named components are called; every other component renders normally (hooks and all) in renderToStaticMarkup.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type AnyFn = (props: any) => unknown;   // eslint-disable-line @typescript-eslint/no-explicit-any -- a component of any props shape

export async function resolveTree(node: React.ReactNode, asyncTypes: ReadonlyArray<AnyFn>): Promise<React.ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((n) => resolveTree(n, asyncTypes)));
  if (!React.isValidElement(node)) return node;
  const el = node as React.ReactElement<{ children?: React.ReactNode }>;
  if (typeof el.type === 'function' && asyncTypes.includes(el.type as AnyFn)) {
    return resolveTree((await (el.type as AnyFn)(el.props)) as React.ReactNode, asyncTypes);
  }
  if (el.props && 'children' in el.props) {
    const children = await resolveTree(el.props.children, asyncTypes);
    return React.cloneElement(el, undefined, ...(Array.isArray(children) ? children : [children]));
  }
  return el;
}

export async function renderResolved(node: React.ReactNode, asyncTypes: ReadonlyArray<AnyFn>): Promise<string> {
  return renderToStaticMarkup(<>{await resolveTree(node, asyncTypes)}</>);
}

/** Visible text of a markup string (tags stripped, entities decoded, whitespace collapsed). */
export const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** The rtl guards (copied from rtl-store1a.render.test.tsx / web-tenant's rtl-sweep): physical classes, physical inline styles, bare arrows. */
const PHYSICAL_CLASS = /^-?(?:m[lr]|p[lr]|left|right)-|^(?:text-(?:left|right)|float-(?:left|right))$|^(?:rounded-[lr]|border-[lr])(?:-|$)/;
const PHYSICAL_STYLE = /(?:margin|padding|border)-(?:left|right)|(?:^|;)\s*(?:left|right)\s*:|text-align\s*:\s*(?:left|right)|float\s*:\s*(?:left|right)/;
export function physical(html: string): string[] {
  const hits: string[] = [];
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c && PHYSICAL_CLASS.test(c)) hits.push(c);
  for (const m of html.matchAll(/\sstyle="([^"]*)"/g)) if (PHYSICAL_STYLE.test(m[1])) hits.push(`style="${m[1]}"`);
  return hits;
}
export const bareArrows = (html: string) => (html.replace(/<span class="kv-dir-flip">→<\/span>/g, '').match(/[→←]/g) ?? []).length;
