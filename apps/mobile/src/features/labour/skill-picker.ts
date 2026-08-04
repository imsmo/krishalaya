// apps/mobile/src/features/labour/skill-picker.ts · PURE logic for the worker Add-a-Skill screen (137). No React /
// no SDK I/O (SDK types `import type` → erased) → unit-tested. It flattens the labour skill catalogue into pickable
// rows (emoji + name from the REAL lookups, reusing worker-skills.skillEmoji) and marks the worker's current
// selection. Save replaces the whole skillIds set via labour.updateWorker (the real contract). The design's
// per-skill DAILY-RATE RANGE (₹350-450/day) has NO field in the skill catalogue, so it is NOT assembled here (§13 —
// omitted, never fabricated); years-of-experience has no worker-profile field either, so it is captured in the
// screen and flagged, never faked into a contract.
import type { Skill } from '@krishalaya/sdk-js';
import { skillEmoji } from './worker-skills';

export interface PickerRow { id: string; name: string; emoji: string; selected: boolean }

/** Flatten the catalogue into pickable rows (order preserved), marking the worker's current selection. Pure. */
export function flatSkillRows(skills: readonly Skill[], selected: ReadonlySet<string>): PickerRow[] {
  return (skills ?? []).map((s) => ({ id: s.id, name: s.name, emoji: skillEmoji(s), selected: selected.has(s.id) }));
}

/** The four experience buckets the design offers. The `years` label is fixed UI chrome; the `key` names the i18n
 * label. Experience has no worker-profile contract field yet → captured in the UI + flagged, never persisted as a
 * fabricated value. Pure constant. */
export const EXPERIENCE_LEVELS = [
  { key: 'beginner', years: '0-2' },
  { key: 'intermediate', years: '3-5' },
  { key: 'skilled', years: '6-10' },
  { key: 'expert', years: '10+' },
] as const;
export type ExperienceKey = (typeof EXPERIENCE_LEVELS)[number]['key'];

/** How many skills are picked (drives the "Save (N skills)" CTA). Pure. */
export function selectedCount(selected: ReadonlySet<string>): number {
  return selected.size;
}
