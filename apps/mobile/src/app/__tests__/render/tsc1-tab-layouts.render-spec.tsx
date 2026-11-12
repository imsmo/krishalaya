// apps/mobile/src/app/__tests__/render/tsc1-tab-layouts.render-spec.tsx · PC-56 TSC-1. The five role tab layouts set
// `sceneContainerStyle` (the cream page behind every tab screen, Law 12 "never a black screen") INSIDE screenOptions.
// In react-navigation v6 it is a NAVIGATOR prop (BottomTabNavigationConfig), so as a screen option it was silently
// ignored. This spec captures the props each layout hands to expo-router's <Tabs> and proves the style now reaches the
// navigator — and that no layout still hides it in screenOptions.
import React from 'react';
import { color } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import { mockExpoRouterMock } from '../../../test-utils/expo-router-mock';
import AmbassadorLayout from '../../(ambassador)/_layout';
import BuyerLayout from '../../(buyer)/_layout';
import FarmerLayout from '../../(farmer)/_layout';
import OwnerLayout from '../../(owner)/_layout';
import WorkerLayout from '../../(worker)/_layout';

const mockTabsProps: Array<Record<string, unknown>> = [];

jest.mock('expo-router', () => {
  const Tabs = (props: Record<string, unknown>) => { mockTabsProps.push(props); return null; };
  Tabs.Screen = () => null;
  return { ...mockExpoRouterMock, Tabs };
});
jest.mock('../../../core/flags/useFlag', () => ({ useFlag: () => true }));
jest.mock('../../../core/auth/auth.store', () => ({ useAuth: () => ({ state: { status: 'authenticated' } }) }));
jest.mock('../../../core/push/push', () => ({ startPush: jest.fn(async () => () => {}) }));

describe('TSC-1 · role tab layouts — the scene background reaches the navigator', () => {
  beforeEach(() => { mockTabsProps.length = 0; });

  it.each([
    ['ambassador', AmbassadorLayout], ['buyer', BuyerLayout], ['farmer', FarmerLayout], ['owner', OwnerLayout], ['worker', WorkerLayout],
  ])('(%s)/_layout passes sceneContainerStyle as a <Tabs> prop', async (_role, Layout) => {
    await renderScreen(<Layout />);
    expect(mockTabsProps).toHaveLength(1);
    const props = mockTabsProps[0];
    expect(props.sceneContainerStyle).toEqual({ backgroundColor: color.page });
    expect(props.screenOptions).not.toHaveProperty('sceneContainerStyle');
  });
});
