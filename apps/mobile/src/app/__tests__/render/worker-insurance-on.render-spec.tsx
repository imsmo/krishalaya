// apps/mobile/src/app/__tests__/render/worker-insurance-on.render-spec.tsx · DEV-24 companion to
// worker-insurance.render-spec.tsx: the flag-ON path. `useFlag` is mocked (module-scope, this file only) to
// force every flag truthy so the screen renders PAST its `worker_app` gate and exercises the REAL DEV-22/23
// data path — asserting the mocked `findPmsbyProduct`/`myPmsbyPolicy` calls actually fire with the resolved
// product id (never fabricated, never skipped) and that the screen still renders without throwing.
import React from 'react';
import { renderScreen } from '../../../test-utils/render';
import WorkerInsurance from '../../(worker)/insurance';

const mockFindPmsbyProduct = jest.fn(async () => ({
  id: 'prod-pmsby-1', partnerId: 'p1', productKindId: 'k1', name: 'PMSBY',
  sumInsuredRules: {}, govtSubsidyBps: 0, ourCommissionBps: 0, isParametric: false, isActive: true, premiumCalc: {},
}));
const mockMyPmsbyPolicy = jest.fn<Promise<null>, [string]>(async () => null);

jest.mock('../../../core/flags/useFlag', () => ({ useFlag: () => true }));
jest.mock('../../../features/insurance/insurance.api', () => ({
  findPmsbyProduct: () => mockFindPmsbyProduct(),
  myPmsbyPolicy: (productId: string) => mockMyPmsbyPolicy(productId),
}));

describe('(worker)/insurance — flag-ON real policy fetch', () => {
  it('renders past the flag gate and fetches the caller\'s own PMSBY product+policy, never fabricating one', async () => {
    const renderer = await renderScreen(<WorkerInsurance />);
    expect(mockFindPmsbyProduct).toHaveBeenCalledTimes(1);
    expect(mockMyPmsbyPolicy).toHaveBeenCalledWith('prod-pmsby-1');
    expect(renderer.root).toBeTruthy();
  });
});
