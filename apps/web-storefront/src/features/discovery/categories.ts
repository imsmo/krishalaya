// apps/web-storefront/src/features/discovery/categories.ts · PURE helpers to turn the SDK category TREE (P1-9
// lookups) into a flat, indented option list for the discovery category facet — real names, never UUIDs. No I/O,
// no framework → unit-testable. The server returns nodes pre-ordered by ltree `path`, so a depth-based indent
// reproduces the hierarchy in a plain <select>. Unknown/empty input degrades to [] (the facet simply hides).
import type { CategoryNode } from '@krishalaya/sdk-js';

export interface CategoryOption { id: string; label: string; depth: number; }

const INDENT = '  '; // figure-spaces — visually nests children without HTML in a <select>

/** Flatten the category tree to indented options (preserving the server's path order). Inactive nodes are dropped. */
export function flattenCategoryNav(nodes: ReadonlyArray<CategoryNode> | null | undefined): CategoryOption[] {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  // Normalise depth to the shallowest present node so a subtree read still indents from zero.
  const minDepth = nodes.reduce((m, n) => (n.isActive && n.depth < m ? n.depth : m), Number.POSITIVE_INFINITY);
  const base = Number.isFinite(minDepth) ? minDepth : 0;
  return nodes
    .filter((n) => n && n.isActive && typeof n.id === 'string' && n.id.length > 0)
    .map((n) => {
      const rel = Math.max(0, (n.depth ?? base) - base);
      return { id: n.id, label: `${INDENT.repeat(rel)}${n.defaultName ?? n.code ?? n.id}`, depth: rel };
    });
}
