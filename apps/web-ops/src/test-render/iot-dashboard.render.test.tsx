// apps/web-ops/src/test-render/iot-dashboard.render.test.tsx · PC-56 OPS-4c · W400 — what the field desk SEES on the sensor dashboard: the monitored
// subjects grouped by the server's type, each linked to W401, each latest reading WITH ITS SOURCE (founder door Q6-A) — a logger's labelled "from
// the logger" with "the device's time", a typed one "typed by a person" with "the time the person recorded it" — and its age; the breaches in 7
// days as the server counts them and the last breach; the registered loggers by serial (never their typed label); soil pods and weather masts
// "registered: N · readings: none"; the Q6 sentences that are printed; NO sum, NO "%", NO "online", NO battery, NO "right now"; zero inputs.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IotDashboardView } from '../components/ops4/IotViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { affirmed, MATH_4A } from './ops4a-fixtures';
import { FALSE_4C, LAST_BREACH, LOGGERS, OVERVIEW, READ_AT, REGISTRY, S_BOX, S_COOLER, S_SHIP } from './ops4c-fixtures';

const page = (over: Partial<React.ComponentProps<typeof IotDashboardView>> = {}, cat: Record<string, string> = en) => renderToStaticMarkup(
  <IotDashboardView t={tr(cat)} state="ok" readAt={READ_AT} overview={OVERVIEW} lastBreach={LAST_BREACH} loggers={LOGGERS} registry={REGISTRY} {...over} />);
const li = (h: string, id: string) => text((new RegExp(`<li[^>]*data-kv-subject="${id}"[\\s\\S]*?</li>`).exec(h) ?? [''])[0]);

describe('PC-56 OPS-4c · iot-dashboard (W400)', () => {
  const h = page();
  it('the subjects grouped by the server\'s type, each by the server\'s label and linked to W401', () => {
    expect((h.match(/data-kv-subject-type="/g) ?? []).length).toBe(4);
    expect(text(h)).toContain('Coolers'); expect(text(h)).toContain('Vaccine boxes'); expect(text(h)).toContain('Shipments'); expect(text(h)).toContain('Warehouse chambers');
    expect(h).toContain(`href="/iot/device?type=bmc_unit&amp;id=${S_COOLER}"`); expect(h).toContain(`href="/iot/device?type=vaccine_box&amp;id=${S_BOX}"`);
    expect((h.match(/data-kv-edge="W401"/g) ?? []).length).toBe(4);
  });
  it('a DEVICE reading is labelled "from the logger" with the device\'s time and its age; a MANUAL one "typed by a person" with the time the person recorded it', () => {
    const cooler = li(h, S_COOLER);
    expect(cooler).toContain('4.20 °C · from the logger · the device\'s time 2026-11-10 02:48 UTC · 12 minutes before this page was read');
    expect(cooler).not.toContain('typed by a person');
    const box = li(h, S_BOX);
    expect(box).toContain('9.10 °C · typed by a person · the time the person recorded it 2026-11-10 02:21 UTC · 39 minutes before this page was read');
    expect(box).not.toContain('from the logger');
    expect(h).toMatch(new RegExp(`data-kv-subject="${S_BOX}"[\\s\\S]*?data-kv-source="manual"`));
    expect(li(h, S_SHIP)).toContain('No reading in the last 30 days.');
  });
  it('each subject\'s logger by serial (or none); the server\'s status in words', () => {
    expect(li(h, S_COOLER)).toContain('Logger LOG-TEST-1'); expect(li(h, S_BOX)).toContain('No logger is mounted on it.');
    expect(li(h, S_SHIP)).toContain('its logger is flagged silent'); expect(li(h, S_BOX)).toContain('the latest reading is outside the band');
  });
  it('the breaches in 7 days as the SERVER counts them, and the last breach; the breach rule in words', () => {
    expect(text(h)).toContain('Breaches opened in the last 7 days, as the server counts them: 2');
    expect(text(h)).toContain('Last breach: Coolers, reference 0192D2C4, opened 2026-11-08 05:10 UTC. Closed 2026-11-08 06:00 UTC.');
    expect(text(h)).toContain('The server opens a breach when two signed readings from the logger in a row are outside the band; a reading typed by a person never opens one.');
    expect(text(page({ lastBreach: null }))).toContain('No breach is on record.');
    expect(text(page({ lastBreach: 'failed' }))).toContain('The last breach could not be read just now.');
  });
  it('the registered loggers by SERIAL — never their typed label — with their last signed reading\'s receipt and what they are mounted on', () => {
    expect((h.match(/data-kv-logger-row="/g) ?? []).length).toBe(3);
    expect(text(h)).toContain('Logger LOG-TEST-1 · registered · last signed reading received by the server 2026-11-10 02:48 UTC · mounted on: Coolers');
    expect(text(h)).toContain('Logger LOG-TEST-3 · registered · no signed reading received yet · no signing key issued');
    expect(h).not.toContain('Testperson'); expect(h).not.toContain('Labelname');
  });
  it('soil pods and weather masts: "registered: N · readings: none" from the registry\'s own counts; nothing about them when that read is off', () => {
    expect(text(h)).toContain('Soil pods registered: 6 · readings: none'); expect(text(h)).toContain('Weather masts registered: 0 · readings: none');
    const off = page({ registry: null });
    expect(off).not.toContain('data-kv-registry'); expect(text(off)).not.toContain('Soil pods registered');
    // the Q6 sentence about them is printed either way
    expect(text(off)).toContain('Soil pods and weather masts are registered only — this platform receives no readings from them.');
  });
  it('the Q6 sentences printed (the second and third); the first is NOT ("timed by the server" — premise false)', () => {
    expect(text(h)).toContain('A reading typed by a person does not show that a sensor is working.');
    expect(text(h)).toContain('Soil pods and weather masts are registered only — this platform receives no readings from them.');
    expect(text(h)).not.toMatch(/timed by the server/i);
    expect(text(h)).toContain('Signed in as you.');
  });
  it('NO sum, NO %, NO "online", NO battery, NO "right now", no ×/=; zero inputs; links to device health', () => {
    expect(FALSE_4C.test(affirmed(visible(h)))).toBe(false); expect(MATH_4A.test(visible(h))).toBe(false);
    expect(/\bonline\b|battery|right now/i.test(visible(h))).toBe(false);
    // no total of the four subjects or three loggers anywhere visible (the server's 2 and the registry's 6 / 0 are the only counts)
    expect(/\b(4|3|7)\b(?! (minutes|days|hours))/.test(visible(h).replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}|\d+\.\d+|0192D2C4|LOG-TEST-\d|AWB-TEST-77|Last 7 days|last 7 days/g, ''))).toBe(false);
    expect(/<input|<select|<textarea|<form|<button/.test(h)).toBe(false);
    expect(h).toContain('href="/iot/device-health"');
  });
  it('the states: off (the flag), forbidden (the permission), error with a re-read (W3326)', () => {
    const off = page({ state: 'off' }); expect(off).toContain('data-kv-off="logistics"'); expect(text(off)).toContain('Logistics is not switched on for your organisation');
    const no = page({ state: 'forbidden' }); expect(no).toContain('data-kv-off="permission"');
    const err = page({ state: 'error', overview: null }); expect(err).toContain('href="/iot/dashboard?act=confirm"'); expect(text(err)).toContain('Nothing was changed.');
    expect(text(page({ overview: { ...OVERVIEW, items: [] } }))).toContain('Nothing is monitored yet');
  });
  it('the refusals by name; the Q6 sentences and the source words in hi / gu', () => {
    for (const id of ['iot_fleet_sum', 'iot_right_now', 'iot_battery', 'iot_calibration', 'iot_soil_readings', 'iot_sync', 'iot_incident_file', 'iot_centre_manager']) expect(h).toContain(`data-kv-refusal="${id}"`);
    for (const cat of [hi, gu]) {
      const x = text(page({}, cat));
      for (const k of ['ops4.q6.typedNotSensor', 'ops4.q6.soilRegistryOnly', 'ops4.iot.source.device', 'ops4.iot.source.manual']) expect([k, x.includes(cat[k])]).toEqual([k, true]);
    }
  });
});
