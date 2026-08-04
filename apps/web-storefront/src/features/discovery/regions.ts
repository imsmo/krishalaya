// apps/web-storefront/src/features/discovery/regions.ts · PURE helpers to turn the SDK region hierarchy
// (lookups.regions — PC-24) into a flat, indented option list for the discovery region facet — real names, never
// UUIDs. Mirrors categories.ts. No I/O, no framework → unit-tested. Unknown/empty input degrades to [] (the
// facet simply hides, Law 12).
import type { RegionNode } from '@krishalaya/sdk-js';

export interface RegionOption { id: string; label: string; depth: number; }

const INDENT = '  '; // figure-spaces — visually nests children without HTML in a <select>

/** Flatten region nodes to indented options. `level` is the server's hierarchy depth (state→district→…);
 *  normalised to the shallowest present level so a subtree read still indents from zero. */
export function flattenRegionNav(nodes: ReadonlyArray<RegionNode> | null | undefined): RegionOption[] {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const minLevel = nodes.reduce((m, n) => (n && typeof n.level === 'number' && n.level < m ? n.level : m), Number.POSITIVE_INFINITY);
  const base = Number.isFinite(minLevel) ? minLevel : 0;
  return nodes
    .filter((n) => n && typeof n.id === 'string' && n.id.length > 0 && typeof n.name === 'string' && n.name.length > 0)
    .map((n) => {
      const rel = Math.max(0, (n.level ?? base) - base);
      return { id: n.id, label: `${INDENT.repeat(rel)}${n.name}`, depth: rel };
    });
}
