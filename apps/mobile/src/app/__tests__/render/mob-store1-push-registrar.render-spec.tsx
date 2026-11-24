// PC-56 MOB-STORE-1 · the role-agnostic PushRegistrar (mounted by the root layout) registers a BUYER — and any other signed-in
// role — for push; before this wave only the (farmer) tab layout called startPush(). Also pins that a tap routes by the role
// active at tap time, and that nothing registers before sign-in / role choice or with the notifications kill-switch off.
import React from 'react';
import { renderScreen } from '../../../test-utils/render';
import { PushRegistrar } from '../../../core/push/PushRegistrar';
import { startPush } from '../../../core/push/push';

let mockState: { status: string; activeRole?: string } = { status: 'authenticated', activeRole: 'buyer' };
let mockFlagOn = true;
jest.mock('../../../core/auth/auth.store', () => ({ useAuth: () => ({ state: mockState }) }));
jest.mock('../../../core/flags/useFlag', () => ({ useFlag: () => mockFlagOn }));
jest.mock('../../../core/push/push', () => ({ startPush: jest.fn(async () => () => {}) }));

const startPushMock = startPush as jest.MockedFunction<typeof startPush>;

describe('MOB-STORE-1 · PushRegistrar', () => {
  beforeEach(() => { startPushMock.mockClear(); mockFlagOn = true; });

  it.each(['buyer', 'worker', 'vet', 'delivery', 'farmer'])('registers a signed-in %s for push', async (role) => {
    mockState = { status: 'authenticated', activeRole: role };
    await renderScreen(<PushRegistrar />);
    expect(startPushMock).toHaveBeenCalledTimes(1);
    const getRole = startPushMock.mock.calls[0][0]!;
    expect(getRole()).toBe(role); // the tap router sees this role
  });

  it('does not register before sign-in, before a role is chosen, or with the notifications flag off', async () => {
    mockState = { status: 'anonymous' };
    await renderScreen(<PushRegistrar />);
    mockState = { status: 'authenticated' };
    await renderScreen(<PushRegistrar />);
    mockState = { status: 'authenticated', activeRole: 'buyer' };
    mockFlagOn = false;
    await renderScreen(<PushRegistrar />);
    expect(startPushMock).not.toHaveBeenCalled();
  });
});
