// apps/mobile/src/test-utils/expo-router-mock.ts · DEV-46 shared render-harness mock for `expo-router`. Every
// pilot-critical screen calls at least one of useRouter/useLocalSearchParams/useFocusEffect, and expo-router's
// real hooks need a live navigation container we don't stand up for a render-floor test — so every render-project
// test file replaces the whole module with this lightweight fake (installed globally, see jest.setup.render.ts).
// `useFocusEffect` runs its callback synchronously on mount (screens key their initial data-load off focus, same
// as a real first-focus) and returns any cleanup so an unmount in a test doesn't throw.
//
// `searchParams` is a plain mutable object a test can set in `beforeEach` (e.g. the OTP verify screen needs
// `{ phone: '+91...' }`) — mutated, not reassigned, so every screen's `useLocalSearchParams()` call always reads
// the latest value.
import { useEffect, type ReactNode } from 'react';

export const mockPush = jest.fn();
export const mockReplace = jest.fn();
export const mockBack = jest.fn();
export const searchParams: Record<string, string | undefined> = {};

export function resetExpoRouterMock(): void {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  for (const k of Object.keys(searchParams)) delete searchParams[k];
}

// Named `mock*` (not `expoRouterMock`) so `jest.setup.render.ts` can reference it directly inside a `jest.mock()`
// factory via a plain top-level ES import — babel-plugin-jest-hoist only allows a factory to close over
// identifiers that either start with `mock` (case-insensitive) or are reached through a literal `require()`
// call; a `mock`-prefixed name avoids needing a `require()` (this repo's own lint forbids `require()` outside a
// couple of pre-existing, already-flagged exceptions).
export const mockExpoRouterMock = {
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  useLocalSearchParams: () => searchParams,
  // Real expo-router semantics: the callback fires once when the screen gains focus (mount-equivalent in a
  // single-screen render test, not "always focused, re-fire every render"). Wired through React's own
  // `useEffect` with an empty dependency array so it genuinely only runs once per mount — a naive
  // "call the callback synchronously on every render" mock caused an infinite `setState`-during-render loop on
  // any screen whose focus callback sets state (every list screen in this batch).
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), []);
  },
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  Link: ({ children }: { children: ReactNode }) => children,
  Redirect: () => null,
};
