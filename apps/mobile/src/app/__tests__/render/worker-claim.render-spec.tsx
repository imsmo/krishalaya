// apps/mobile/src/app/__tests__/render/worker-claim.render-spec.tsx · DEV-24 render-floor test for
// src/app/(worker)/claim.tsx (screen 146) after wiring the REAL claim-filing endpoint (DEV-23). `worker_app`
// defaults OFF, unmocked here (real flag store) — the screen must take its flag-gated EmptyState branch before
// ever calling `findPmsbyProduct()`/`myPmsbyPolicy()`. The flag-ON paths (no-active-policy gate, and the real
// claim form once an active policy exists) are covered separately in worker-claim-on.render-spec.tsx.
import React from 'react';
import { EmptyState } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import FileClaim from '../../(worker)/claim';

const mockFindPmsbyProduct = jest.fn(async () => null);
const mockMyPmsbyPolicy = jest.fn<Promise<null>, [string]>(async () => null);
const mockFileClaim = jest.fn();

jest.mock('../../../features/insurance/insurance.api', () => ({
  findPmsbyProduct: () => mockFindPmsbyProduct(),
  myPmsbyPolicy: (productId: string) => mockMyPmsbyPolicy(productId),
  fileClaim: (input: unknown) => mockFileClaim(input),
}));
// `core/media` transitively imports `core/api/client` -> `core/config`, which throws at MODULE-LOAD time (fail-
// closed by design) when EXPO_PUBLIC_API_URL isn't set in this jest environment — same pre-existing pattern
// today-orders.render-spec.tsx documents for `core/deeplink`. Not a runtime crash path: `claim.tsx` only invokes
// these on a user tap (photo pick), never during render.
jest.mock('../../../core/media', () => ({
  captureFromCamera: jest.fn(),
  pickFromGallery: jest.fn(),
  uploadPickedImage: jest.fn(),
}));

describe('(worker)/claim — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (worker_app defaults OFF)', async () => {
    const renderer = await renderScreen(<FileClaim />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
    expect(mockFindPmsbyProduct).not.toHaveBeenCalled();
    expect(mockFileClaim).not.toHaveBeenCalled();
  });
});
