// apps/mobile/src/app/__tests__/render/hire-workers.render-spec.tsx · DEV-46 render-floor test for
// src/app/(farmer)/hire/workers.tsx (pilot-ON module 6: basic labour, casual day-labour scope — master-plan
// §2.1 row 6). The `labour_hire` flag defaults OFF (real flag store) so the screen takes its flag-gated
// EmptyState branch before `browseWorkers()`/`labourLookups()` ever run.
import React from 'react';
import { EmptyState } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import BrowseWorkers from '../../(farmer)/hire/workers';

jest.mock('../../../features/labour/hire.api', () => ({
  browseWorkers: jest.fn(async () => ({ items: [], nextCursor: null })),
  labourLookups: jest.fn(async () => ({ skills: [], regions: [] })),
}));

describe('(farmer)/hire/workers — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (labour_hire defaults OFF)', async () => {
    const renderer = await renderScreen(<BrowseWorkers />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });
});
