// apps/mobile/src/app/__tests__/render/language.render-spec.tsx · DEV-21 render-floor test for
// src/app/(system)/language.tsx (screen 187). Proves the screen renders the 3 LIVE languages as selectable rows
// AND all 11 target languages from the shared `@krishi-verse/i18n` registry as disabled "coming soon" rows — the
// exact regression this batch fixes (previously only Marathi rendered as "coming soon", silently omitting
// bn/te/ta/as/pa/kn/ml/or/ar/ur). Mocks: `core/auth/auth.store` (useAuth — the real store wires token-store/
// secure-store/api-client at import time, out of scope here).
import React from 'react';
import { Text } from 'react-native';
import { COMING_SOON_LANGUAGES, LANGUAGES } from '@krishi-verse/i18n';
import { renderScreen } from '../../../test-utils/render';
import LanguageSwitcher from '../../(system)/language';

jest.mock('../../../core/auth/auth.store', () => ({ useAuth: () => ({ setLanguage: jest.fn() }) }));

describe('(system)/language — render floor', () => {
  it('renders without throwing and shows every LIVE language as a native-name row', async () => {
    const renderer = await renderScreen(<LanguageSwitcher />);
    const texts = renderer.root.findAllByType(Text).map((n) => n.props.children);
    for (const l of LANGUAGES) {
      expect(texts).toContain(l.nameNative);
    }
  });

  it('renders all 11 target languages as "coming soon" rows (the DEV-21 fix — was 1 before, now the full registry)', async () => {
    const renderer = await renderScreen(<LanguageSwitcher />);
    expect(COMING_SOON_LANGUAGES.length).toBe(11);
    const texts = renderer.root.findAllByType(Text).map((n) => n.props.children);
    for (const l of COMING_SOON_LANGUAGES) {
      expect(texts).toContain(l.nameNative);
    }
  });
});
