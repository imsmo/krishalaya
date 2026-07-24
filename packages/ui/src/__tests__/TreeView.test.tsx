// packages/ui/src/__tests__/TreeView.test.tsx · DEV-17.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TreeView, type TreeNode } from '../components/TreeView';

const nodes: TreeNode[] = [
  {
    key: 'gj',
    label: 'Gujarat',
    meta: '(1,842 farmers)',
    children: [
      { key: 'junagadh', label: 'Junagadh cluster', meta: '(614)' },
      { key: 'rajkot', label: 'Rajkot cluster', meta: '(509)' },
    ],
  },
  { key: 'mh', label: 'Maharashtra', meta: '(0 — Y2 launch)' },
];

describe('TreeView', () => {
  it('renders role=tree/treeitem, aria-expanded only on parent nodes, collapsed children hidden', () => {
    const html = renderToStaticMarkup(
      <TreeView nodes={nodes} expandedKeys={new Set()} onToggleExpand={() => {}} onSelect={() => {}} ariaLabel="Tenant geography tree" />,
    );
    expect(html).toContain('role="tree"');
    expect(html).toContain('aria-label="Tenant geography tree"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Junagadh cluster'); // collapsed — nested <ul> not rendered
    // Leaf-node (no aria-expanded at all) vs parent-node (aria-expanded="false") distinction is asserted
    // precisely, per-node, in the next test — a document-wide "not.toContain('aria-expanded')" here would
    // be self-contradictory since the line above already confirms one occurrence exists.
  });

  it('expands a node (per expandedKeys) and renders its children, with the leaf carrying no aria-expanded', () => {
    const html = renderToStaticMarkup(
      <TreeView nodes={nodes} expandedKeys={new Set(['gj'])} onToggleExpand={() => {}} onSelect={() => {}} ariaLabel="Tenant geography tree" />,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Junagadh cluster');
    expect(html).toContain('Rajkot cluster');
    // Maharashtra is a leaf (no children) — its own <li> must carry no aria-expanded attribute.
    const mhLiMatch = html.match(/<li role="treeitem"[^>]*>(?:(?!<li).)*Maharashtra/s);
    expect(mhLiMatch).not.toBeNull();
    expect(mhLiMatch![0]).not.toContain('aria-expanded');
  });

  it('marks the selected node with is-selected', () => {
    const html = renderToStaticMarkup(
      <TreeView nodes={nodes} selectedKey="junagadh" expandedKeys={new Set(['gj'])} onToggleExpand={() => {}} onSelect={() => {}} ariaLabel="Tree" />,
    );
    expect(html).toContain('kvw-tree-item is-selected');
  });

  it('renders the RTL-mirroring chevron class only for nodes with children', () => {
    const html = renderToStaticMarkup(
      <TreeView nodes={nodes} expandedKeys={new Set()} onToggleExpand={() => {}} onSelect={() => {}} ariaLabel="Tree" />,
    );
    const chevronCount = (html.match(/class="chevron"/g) ?? []).length;
    expect(chevronCount).toBe(1); // only "Gujarat" has children; "Maharashtra" (leaf) gets none
  });
});
