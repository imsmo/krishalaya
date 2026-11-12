// PC-56 TSC-1 · core/voice/stt.client isSttAvailable. The native recognizer answers a BOOLEAN (Voice.m `@[@true]`,
// VoiceModule.java `Boolean`) although @react-native-voice types it 0 | 1. The old code compared the typed number to
// `true` and, on a boolean answer, asked the recognizer twice (each iOS ask is an authorization request). Now: one
// ask, either shape accepted.
const mockIsAvailable = jest.fn();
jest.mock('@react-native-voice/voice', () => ({ __esModule: true, default: { isAvailable: () => mockIsAvailable() } }));

import { availabilityIsYes, isSttAvailable } from '../voice/stt.client';

describe('availabilityIsYes', () => {
  it('accepts 1 and true; refuses 0, false and anything else', () => {
    expect(availabilityIsYes(1)).toBe(true);
    expect(availabilityIsYes(true)).toBe(true);
    expect(availabilityIsYes(0)).toBe(false);
    expect(availabilityIsYes(false)).toBe(false);
    expect(availabilityIsYes('1')).toBe(false);
    expect(availabilityIsYes(undefined)).toBe(false);
  });
});

describe('isSttAvailable', () => {
  beforeEach(() => mockIsAvailable.mockReset());

  it.each([[true, true], [1, true], [false, false], [0, false]])('native answer %p → %p, asking the recognizer exactly once', async (answer, expected) => {
    mockIsAvailable.mockResolvedValue(answer);
    await expect(isSttAvailable()).resolves.toBe(expected);
    expect(mockIsAvailable).toHaveBeenCalledTimes(1);
  });

  it('degrades to false when the native module throws', async () => {
    mockIsAvailable.mockRejectedValue(new Error('no recognizer'));
    await expect(isSttAvailable()).resolves.toBe(false);
  });
});
