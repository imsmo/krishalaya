// apps/mobile/src/app/__tests__/render/feedback.render-spec.tsx · DEV-46 render-floor test for
// src/app/(system)/feedback.tsx (pilot-ON module 8: support, the feedback-CTA half of the ticketing surface —
// master-plan §2.1 row 8). The `system_screens` flag defaults OFF (real flag store) so the screen takes its
// flag-gated EmptyState branch before `submitFeedback()` is ever wired to a real Submit press.
import React from 'react';
import { EmptyState } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import Feedback from '../../(system)/feedback';

jest.mock('../../../features/system/system.api', () => ({ submitFeedback: jest.fn(async () => {}) }));

describe('(system)/feedback — render floor', () => {
  it('renders without throwing and honors the flag-OFF EmptyState (system_screens defaults OFF)', async () => {
    const renderer = await renderScreen(<Feedback />);
    const empty = renderer.root.findByType(EmptyState);
    expect(empty.props.title).toBeTruthy();
  });
});
