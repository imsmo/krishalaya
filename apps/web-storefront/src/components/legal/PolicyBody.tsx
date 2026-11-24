// apps/web-storefront/src/components/legal/PolicyBody.tsx · PC-56 LEGAL-1 — a policy's body, rendered from the parsed tree
// (features/legal/markdown.ts → tokens.ts) as React elements ONLY: no dangerouslySetInnerHTML, so every character of the source — a `<script>`
// included — reaches the page as escaped text. Links carry the href markdown.ts allowed (http(s) external links get rel="noopener noreferrer");
// a fact prints its value (a mailbox as a mailto link via `mailtoHref`, unless it already sits inside a link), an empty fact the localized
// "not published yet" (`data-kv-fact-state="unpublished"`).
import * as React from 'react';
import { getTranslator } from '../../lib/i18n';
import { mailtoHref } from '../../features/sweep/facts';
import type { FactBlock, FactInline } from '../../features/legal/tokens';

function Inlines({ nodes, inLink = false }: { nodes: FactInline[]; inLink?: boolean }) {
  const t = getTranslator();
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text': return <React.Fragment key={i}>{n.v}</React.Fragment>;
          case 'strong': return <strong key={i}><Inlines nodes={n.c} inLink={inLink} /></strong>;
          case 'em': return <em key={i}><Inlines nodes={n.c} inLink={inLink} /></em>;
          case 'link': return n.external
            ? <a key={i} href={n.href} rel="noopener noreferrer" data-kv-policy-link="external"><Inlines nodes={n.c} inLink /></a>
            : <a key={i} href={n.href} data-kv-policy-link="internal"><Inlines nodes={n.c} inLink /></a>;
          case 'fact': {
            if (n.line.kind === 'unpublished') return <em key={i} data-kv-fact={n.name} data-kv-fact-state="unpublished">{t.t('sweep.fact.unpublished')}</em>;
            const mail = n.mail && !inLink ? mailtoHref(n.line) : null;
            return mail
              ? <a key={i} href={mail} data-kv-fact={n.name} data-kv-fact-state="set">{n.line.value}</a>
              : <span key={i} data-kv-fact={n.name} data-kv-fact-state="set">{n.line.value}</span>;
          }
        }
      })}
    </>
  );
}

export function PolicyBody({ blocks }: { blocks: FactBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'heading': {
            const H = (`h${b.level}`) as 'h2' | 'h3' | 'h4';
            return <H key={i} id={b.id}><Inlines nodes={b.c} /></H>;
          }
          case 'paragraph': return <p key={i}><Inlines nodes={b.c} /></p>;
          case 'list': return b.ordered
            ? <ol key={i} start={b.start === 1 ? undefined : b.start}>{b.items.map((it, j) => <li key={j}><Inlines nodes={it} /></li>)}</ol>
            : <ul key={i}>{b.items.map((it, j) => <li key={j}><Inlines nodes={it} /></li>)}</ul>;
          case 'rule': return <hr key={i} />;
        }
      })}
    </>
  );
}
