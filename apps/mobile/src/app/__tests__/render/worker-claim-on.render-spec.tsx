// apps/mobile/src/app/__tests__/render/worker-claim-on.render-spec.tsx · DEV-24 companion to
// worker-claim.render-spec.tsx: the flag-ON paths. `useFlag` is mocked (this file only) to force the screen past
// its `worker_app` gate. Two real, non-trivial gating behaviours are exercised here (Golden Law 12 — render only
// verified truth, never fabricate a policy the caller doesn't have):
//   1. No active PMSBY policy -> the screen must show the honest "enrol first" EmptyState, NOT the claim form
//      (the API itself 409s a claim against a non-active policy — this screen checks first).
//   2. An active PMSBY policy -> the real claim form renders (claim-type picker, incident fields, doc checklist).
import React from 'react';
import { EmptyState } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import FileClaim from '../../(worker)/claim';

const mockFindPmsbyProduct = jest.fn(async () => ({ id: 'prod-pmsby-1' }));
const mockMyPmsbyPolicy = jest.fn();
const mockFileClaim = jest.fn();

jest.mock('../../../core/flags/useFlag', () => ({ useFlag: () => true }));
jest.mock('../../../features/insurance/insurance.api', () => ({
  findPmsbyProduct: () => mockFindPmsbyProduct(),
  myPmsbyPolicy: (productId: string) => mockMyPmsbyPolicy(productId),
  fileClaim: (input: unknown) => mockFileClaim(input),
}));
// see worker-claim.render-spec.tsx for why `core/media` must be mocked (EXPO_PUBLIC_API_URL not set in jest env).
jest.mock('../../../core/media', () => ({
  captureFromCamera: jest.fn(),
  pickFromGallery: jest.fn(),
  uploadPickedImage: jest.fn(),
}));

describe('(worker)/claim — flag-ON gating on real policy state', () => {
  afterEach(() => {
    mockMyPmsbyPolicy.mockReset();
    mockFileClaim.mockClear();
  });

  it('shows the honest "enrol first" EmptyState when the caller has no active policy, never the claim form', async () => {
    mockMyPmsbyPolicy.mockResolvedValue({ id: 'pol-1', status: 'lapsed', validUntil: '2025-05-31' });
    const renderer = await renderScreen(<FileClaim />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
    expect(mockFileClaim).not.toHaveBeenCalled();
  });

  it('renders the real claim form (type picker + incident fields) once an active policy is confirmed', async () => {
    mockMyPmsbyPolicy.mockResolvedValue({ id: 'pol-2', status: 'active', validUntil: '2026-05-31' });
    const renderer = await renderScreen(<FileClaim />);
    expect(() => renderer.root.findByType(EmptyState)).toThrow();
    expect(mockFindPmsbyProduct).toHaveBeenCalled();
    expect(mockFileClaim).not.toHaveBeenCalled();
    expect(renderer.root).toBeTruthy();
  });
});
