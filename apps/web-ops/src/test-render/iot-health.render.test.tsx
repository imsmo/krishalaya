// apps/web-ops/src/test-render/iot-health.render.test.tsx · PC-56 OPS-4c · W404 — the loggers the SERVER has flagged silent: each by serial, what it is
// mounted on, its last signed reading's receipt time, when it was flagged, the alert state, whether a signed reading has ended it; the silence
// threshold printed FROM THE SERVER's number (the fixture says 37, not the platform's 15 — a literal in the page is caught); "a reading typed by a
// person never ends a silence"; no cause, no action, no battery, no calibration, no field visit, no paging; zero inputs.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IotHealthView } from '../components/ops4/IotViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { affirmed, MATH_4A } from './ops4a-fixtures';
import { FALSE_4C, LOGGERS, S_SHIP, SILENCES, SILENCE_MINUTES } from './ops4c-fixtures';

const page = (over: Partial<React.ComponentProps<typeof IotHealthView>> = {}, cat: Record<string, string> = en) => renderToStaticMarkup(
  <IotHealthView t={tr(cat)} state="ok" silences={SILENCES} loggers={LOGGERS} silenceMinutes={SILENCE_MINUTES} {...over} />);

describe('PC-56 OPS-4c · iot-health (W404)', () => {
  const h = page();
  it('the server\'s threshold, printed from the server\'s number — never a literal', () => {
    expect(text(h)).toContain('The server flags a logger silent when its last signed reading was received more than 37 minutes ago.');
    expect(h).toContain('data-kv-silence-minutes="37"');
    expect(text(page({ silenceMinutes: 22 }))).toContain('more than 22 minutes ago');
    expect(text(h)).not.toMatch(/\b15 minutes/);
    expect(page({ silenceMinutes: null })).not.toContain('data-kv-silence-minutes');
  });
  it('each flagged silence: the logger\'s serial, what it is mounted on, its last signed reading, flagged, the alert state, ended or not', () => {
    expect((h.match(/data-kv-silence="/g) ?? []).length).toBe(2);
    expect(text(h)).toContain('Logger LOG-TEST-2 · mounted on: Shipments · last signed reading received by the server 2026-11-09 21:10 UTC · flagged 2026-11-09 21:48 UTC · an alert was raised for the people named on the organisation\'s alert rules · not ended');
    expect(text(h)).toContain('no one is named on the organisation\'s alert rules, so no one was alerted · ended by a signed reading 2026-11-08 05:00 UTC');
    expect(h).toContain(`href="/iot/device?type=shipment&amp;id=${S_SHIP}"`);
  });
  it('a typed reading never ends a silence (said); no cause, action, battery, calibration, field visit or paging; zero inputs', () => {
    expect(text(h)).toContain('A reading typed by a person never ends a silence: only the logger\'s next signed reading does.');
    expect(FALSE_4C.test(affirmed(visible(h)))).toBe(false); expect(MATH_4A.test(visible(h))).toBe(false);
    expect(/<input|<select|<textarea|<form|<button/.test(h)).toBe(false);
    expect(h).not.toContain('Testperson');
  });
  it('the states: none flagged, off, error with a re-read (W3307)', () => {
    expect(text(page({ silences: [] }))).toContain('The server has flagged no silence.');
    expect(page({ state: 'off' })).toContain('data-kv-off="logistics"');
    expect(page({ state: 'error' })).toContain('href="/iot/device-health?act=confirm"');
  });
  it('the refusals by name; in hi / gu the server\'s number prints too', () => {
    for (const id of ['iot_own_threshold', 'iot_likely_cause', 'iot_field_visit', 'iot_paged', 'iot_battery', 'iot_calibration']) expect(h).toContain(`data-kv-refusal="${id}"`);
    for (const cat of [hi, gu]) expect(text(page({}, cat))).toContain(cat['ops4.iot.health.threshold'].replace('{minutes}', '37'));
  });
});
