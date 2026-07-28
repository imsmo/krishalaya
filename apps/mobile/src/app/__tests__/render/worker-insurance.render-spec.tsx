// apps/mobile/src/app/__tests__/render/worker-insurance.render-spec.tsx · DEV-24 render-floor test for
// src/app/(worker)/insurance.tsx (screen 39, PMSBY worker home) after wiring the REAL insurance module
// (DEV-22/23). `worker_app` defaults OFF (flags.ts DEFAULTS.worker_app = false, unmocked here — exercises the
// REAL flag store, mirroring worker-jobs.render-spec.tsx's own convention) so the screen must take its
// flag-gated EmptyState branch before ever calling `findPmsbyProduct()`. The flag-ON path (real policy
// fetch/enrolment CTA) is covered separately in worker-insurance-on.render-spec.tsx, in its own file — jest.mock
// hoists to module scope, so the ON path's `useFlag` override cannot safely share a file with this OFF test.
import React from 'react';
import { EmptyState } from '@krishi-verse/ui-native';
import { renderScreen } from '../../../test-utils/render';
import WorkerInsurance from '../../(worker)/insurance';

const mockFindPmsbyProduct = jest.fn(async () => null);
const mockMyPmsbyPolicy = jest.fn<Promise<null>, [string]>(async () => null);

jest.mock('../../../features/insurance/insurance.api', () => ({
  findPmsbyProduct: () => mockFindPmsbyProduct(),
  myPmsbyPolicy: (productId: string) => mockMyPmsbyPolicy(productId),
}));

describe('(worker)/insurance — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (worker_app defaults OFF)', async () => {
    const renderer = await renderScreen(<WorkerInsurance />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
    // the ON-path data call must never fire while the module is flagged off (degrade-never-die / Golden Law 8)
    expect(mockFindPmsbyProduct).not.toHaveBeenCalled();
  });
});
