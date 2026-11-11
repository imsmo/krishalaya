// packages/ui-native/src/components/Icon.tsx · the single line-icon primitive for the whole app. SVG stroke
// icons (react-native-svg) rendered at any size in any theme colour — screens NEVER inline raw SVG or import an
// icon font. Add a new glyph by adding one entry to ICONS (a 24×24 stroke path or path-set). Decorative by
// default (a11y-hidden); pass `label` to expose it to screen readers. Colour/size come from theme tokens at the
// call-site (e.g. color.accent300, font.size.xl) — never hardcode.
//
// PC-56 RTL-1h-2: a DIRECTIONAL glyph (an arrow or a chevron: 'back', 'next', 'opens') is drawn mirrored when the app is laid out
// right-to-left, because React Native flips the layout around it but never an SVG path. Every other glyph (a wheat, a bell, a check,
// a phone …) is never mirrored. The direction is read from React Native's own `I18nManager.isRTL` at render — the layout the
// icon actually sits in — and not from a prop, so all 21 directional uses in the app follow it with no call-site change. It is
// true only after a person chose Arabic and reopened the app (apps/mobile core/mechanisms/rtlBoot.ts locks it off otherwise).
import React from 'react';
import { I18nManager } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { color as theme } from '../theme';

export type IconName =
  | 'wheat' | 'check' | 'arrow-right' | 'arrow-left' | 'chevron-right' | 'globe'
  | 'camera' | 'mic' | 'bell' | 'home' | 'bag' | 'wallet' | 'user' | 'location'
  | 'phone' | 'search' | 'plus' | 'close' | 'calendar' | 'star' | 'shield'
  | 'sprout' | 'truck' | 'building' | 'user-check';

// Each entry is an array of <Path>/<Circle> primitives drawn on a 0 0 24 24 grid, stroked (not filled) unless
// noted. Kept deliberately small + consistent (stroke-linecap/линejoin round) to match the design system.
const ICONS: Record<IconName, React.ReactNode> = {
  wheat: (<>
    <Path d="M12 3v18" /><Path d="M8 6c0 2 2 3.5 4 3.5" /><Path d="M16 6c0 2-2 3.5-4 3.5" />
    <Path d="M8 11c0 2 2 3.5 4 3.5" /><Path d="M16 11c0 2-2 3.5-4 3.5" />
    <Path d="M8 16c0 2 2 3.5 4 3.5" /><Path d="M16 16c0 2-2 3.5-4 3.5" />
  </>),
  check: <Path d="M20 6 9 17l-5-5" />,
  'arrow-right': (<><Path d="M5 12h14" /><Path d="m13 5 7 7-7 7" /></>),
  'arrow-left': (<><Path d="M19 12H5" /><Path d="m11 19-7-7 7-7" /></>),
  'chevron-right': <Path d="m9 6 6 6-6 6" />,
  globe: (<><Circle cx="12" cy="12" r="9" /><Path d="M3 12h18" /><Path d="M12 3c2.5 2.7 2.5 15.3 0 18" /><Path d="M12 3c-2.5 2.7-2.5 15.3 0 18" /></>),
  camera: (<><Path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6h0a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" /><Circle cx="12" cy="13" r="3.5" /></>),
  mic: (<><Path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /><Path d="M5 11a7 7 0 0 0 14 0" /><Path d="M12 18v3" /></>),
  bell: (<><Path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" /><Path d="M10 21a2 2 0 0 0 4 0" /></>),
  home: (<><Path d="m3 11 9-7 9 7" /><Path d="M5 10v10h14V10" /></>),
  bag: (<><Path d="M6 8h12l-1 12H7L6 8z" /><Path d="M9 8a3 3 0 0 1 6 0" /></>),
  wallet: (<><Path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /><Path d="M16 12h4" /><Circle cx="16.5" cy="12" r="1" /></>),
  user: (<><Circle cx="12" cy="8" r="4" /><Path d="M4 21a8 8 0 0 1 16 0" /></>),
  location: (<><Path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" /><Circle cx="12" cy="10" r="2.5" /></>),
  phone: <Path d="M5 4h4l2 5-3 2a13 13 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  search: (<><Circle cx="11" cy="11" r="7" /><Path d="m20 20-3.5-3.5" /></>),
  plus: (<><Path d="M12 5v14" /><Path d="M5 12h14" /></>),
  close: (<><Path d="M6 6l12 12" /><Path d="M18 6 6 18" /></>),
  calendar: (<><Path d="M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /><Path d="M4 9h16" /><Path d="M8 3v4" /><Path d="M16 3v4" /></>),
  star: <Path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 17l-5.4 2.5 1.2-6L3.3 9.3l6.1-.7L12 3z" />,
  shield: (<><Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><Path d="M9 12l2 2 4-4" /></>),
  // Role glyphs — paths ported 1:1 from the Phase-1 04-role design (sprout/truck/building/user-check).
  sprout: (<><Path d="M12 2v6m-6 6c0-3.5 2.5-6 6-6s6 2.5 6 6c0 5-6 8-6 8s-6-3-6-8z" /><Path d="M9 14c0-2 1.5-3 3-3" /></>),
  truck: (<><Path d="M1 3h15v13H1z" /><Path d="M16 8h4l3 3v5h-7" /><Circle cx="5.5" cy="18.5" r="2.5" /><Circle cx="18.5" cy="18.5" r="2.5" /></>),
  building: (<><Path d="M3 21V8l9-5 9 5v13" /><Path d="M9 22V12h6v10" /></>),
  'user-check': (<><Circle cx="9" cy="7" r="4" /><Path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><Path d="M16 11l2 2 4-4" /></>),
};

/** The glyphs that point a way and so mirror under right-to-left. Nothing else ever mirrors. */
export const DIRECTIONAL_ICONS: ReadonlySet<IconName> = new Set<IconName>(['arrow-left', 'arrow-right', 'chevron-right']);

/** Whether `name` is drawn mirrored in a layout whose direction is `rtl`. */
export function iconMirrors(name: IconName, rtl: boolean): boolean {
  return rtl && DIRECTIONAL_ICONS.has(name);
}

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** Stroke width on the 24-grid. */
  weight?: number;
  /** Provide to expose the icon to screen readers; omit to keep it decorative (default). */
  label?: string;
}

export function Icon({ name, size = 24, color = theme.ink700, weight = 2, label }: IconProps) {
  const mirrored = iconMirrors(name, I18nManager.isRTL);
  return (
    <Svg
      style={mirrored ? MIRROR : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
    >
      {ICONS[name]}
    </Svg>
  );
}

const MIRROR = { transform: [{ scaleX: -1 }] };
