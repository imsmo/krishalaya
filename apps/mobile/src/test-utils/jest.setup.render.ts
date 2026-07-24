// apps/mobile/src/test-utils/jest.setup.render.ts · DEV-46 setupFiles entry for the "render" jest project ONLY
// (wired in jest.config.js, does not touch the "core" project's setup — there is none). Runs before every render-
// project test file loads. Installs the one mock every pilot-critical screen needs regardless of which one is
// under test: `expo-router` (see expo-router-mock.ts for why — no live navigation container in a render-floor
// test). Screen-specific mocks (feature `*.api` modules, `core/auth/*`, `core/security/*`) are declared per spec
// file, right next to the screen they gate, so a reviewer can see exactly what's faked for that one screen
// without hunting through a shared registry.
import { mockExpoRouterMock } from './expo-router-mock';

jest.mock('expo-router', () => mockExpoRouterMock);
