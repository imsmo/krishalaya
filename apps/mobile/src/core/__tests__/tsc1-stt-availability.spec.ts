// PC-56 TSC-1 · core/voice/stt.client isSttAvailable. The old native recognizer answered a BOOLEAN although its
// package typed it 0 | 1; the old code compared the typed number to `true` and, on a boolean answer, asked the
// recognizer twice (each iOS ask is an authorization request). Now: one ask, either shape accepted.
// MOB-SDK-1: the recognizer is expo-speech-recognition (replaces @react-native-voice/voice, which does not build on
// React Native 0.88). The same contract is pinned against the new module, plus the start/stop wiring.
const mockIsAvailable = jest.fn();
const mockRequestPermissions = jest.fn();
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockListeners: Record<string, ((e: unknown) => void) | undefined> = {};
const mockRemove = jest.fn();
jest.mock('expo-speech-recognition', () => ({
  __esModule: true,
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: () => mockIsAvailable(),
    requestPermissionsAsync: () => mockRequestPermissions(),
    start: (o: unknown) => mockStart(o),
    stop: () => mockStop(),
    addListener: (name: string, fn: (e: unknown) => void) => {
      mockListeners[name] = fn;
      return { remove: () => { mockRemove(name); mockListeners[name] = undefined; } };
    },
  },
}));

import { availabilityIsYes, isSttAvailable, startStt, stopStt } from '../voice/stt.client';

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
    mockIsAvailable.mockReturnValue(answer);
    await expect(isSttAvailable()).resolves.toBe(expected);
    expect(mockIsAvailable).toHaveBeenCalledTimes(1);
  });

  it('degrades to false when the native module throws', async () => {
    mockIsAvailable.mockImplementation(() => { throw new Error('no recognizer'); });
    await expect(isSttAvailable()).resolves.toBe(false);
  });
});

describe('startStt / stopStt', () => {
  beforeEach(() => { jest.clearAllMocks(); for (const k of Object.keys(mockListeners)) mockListeners[k] = undefined; });

  it('permission refused → onError, the recognizer never starts', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: false });
    const onError = jest.fn();
    await startStt('hi-IN', { onError });
    expect(onError).toHaveBeenCalledWith('stt_permission_denied');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('starts in the given locale and routes partial / final / error events', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: true });
    const h = { onPartial: jest.fn(), onFinal: jest.fn(), onError: jest.fn() };
    await startStt('gu-IN', h);
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ lang: 'gu-IN', interimResults: true }));
    mockListeners.result?.({ isFinal: false, results: [{ transcript: 'ghau' }] });
    mockListeners.result?.({ isFinal: true, results: [{ transcript: 'ghau 10 quintal' }] });
    mockListeners.result?.({ isFinal: true, results: [] });
    mockListeners.error?.({ error: 'network', message: '' });
    expect(h.onPartial).toHaveBeenCalledWith('ghau');
    expect(h.onFinal).toHaveBeenCalledTimes(1);
    expect(h.onFinal).toHaveBeenCalledWith('ghau 10 quintal');
    expect(h.onError).toHaveBeenCalledWith('network');
  });

  it('a start that throws reports through onError and never throws itself', async () => {
    mockRequestPermissions.mockRejectedValue(new Error('module missing'));
    const onError = jest.fn();
    await expect(startStt('hi-IN', { onError })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith('module missing');
  });

  it('stop stops the recognizer and removes every listener; never throws', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: true });
    await startStt('hi-IN', {});
    mockStop.mockImplementation(() => { throw new Error('not running'); });
    await expect(stopStt()).resolves.toBeUndefined();
    expect(mockRemove).toHaveBeenCalledWith('result');
    expect(mockRemove).toHaveBeenCalledWith('error');
  });
});
