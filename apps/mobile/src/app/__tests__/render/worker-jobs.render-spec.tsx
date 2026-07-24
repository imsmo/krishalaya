// apps/mobile/src/app/__tests__/render/worker-jobs.render-spec.tsx · DEV-46 render-floor test for
// src/app/(worker)/jobs.tsx (pilot-ON module 6: basic labour, worker's own Find Jobs side — master-plan §2.1
// row 6). The `worker_app` flag defaults OFF (real flag store) so the screen takes its flag-gated EmptyState
// branch before `browseJobs()`/`labourLookups()` ever run.
import React from 'react';
import { EmptyState } from '@krishi-verse/ui-native';
import { renderScreen } from '../../../test-utils/render';
import Jobs from '../../(worker)/jobs';

jest.mock('../../../features/labour/labour.api', () => ({
  browseJobs: jest.fn(async () => ({ items: [], nextCursor: null })),
  labourLookups: jest.fn(async () => ({ skills: [], regions: [] })),
}));

describe('(worker)/jobs — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (worker_app defaults OFF)', async () => {
    const renderer = await renderScreen(<Jobs />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });
});
