// apps/mobile/src/app/__tests__/render/welcome.render-spec.tsx · DEV-46 render-floor test for
// src/app/(auth)/welcome.tsx (pilot-ON module 1: Auth/OTP — master-plan §2.1 row 1). Pure presentation screen,
// no flag, no fetch (cannot throw on data per the screen's own header comment) — the render-floor assertion here
// is simply: mounts without throwing + the real "Get Started" CTA (Button) is present, proving the component
// tree actually built (a JSX/import error would throw during `renderScreen`, not just fail an assertion).
import React from 'react';
import { Button } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import Welcome from '../../(auth)/welcome';

describe('(auth)/welcome — render floor', () => {
  it('renders without throwing and shows the Get Started action', async () => {
    const renderer = await renderScreen(<Welcome />);
    const cta = renderer.root.findByType(Button);
    expect(cta.props.title).toBeTruthy();
  });
});
