// apps/web-ops/src/test-render/iot-device.render.test.tsx · PC-56 OPS-4c · W401 — one monitored subject: its trail over the server's window, EACH POINT
// by its source with BOTH times named ("the device's time" / "the time the person recorded it", and "received by the server"); the band; the
// logger's serial; the breach rule as the server implements it; its breaches; NOTHING drawn between points; the one input is the hours window (a
// GET); and NO battery, calibration or cadence — even though the fixture carries all three.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IotDeviceView } from '../components/ops4/IotViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { affirmed, MATH_4A } from './ops4a-fixtures';
import { DETAIL, FALSE_4C, READ_AT, S_COOLER } from './ops4c-fixtures';

const page = (over: Partial<React.ComponentProps<typeof IotDeviceView>> = {}, cat: Record<string, string> = en) => renderToStaticMarkup(
  <IotDeviceView t={tr(cat)} state="ok" readAt={READ_AT} hours={48} type="bmc_unit" id={S_COOLER} detail={DETAIL} {...over} />);

describe('PC-56 OPS-4c · iot-device (W401)', () => {
  const h = page();
  it('the subject by type and the server\'s label; the band; the logger\'s serial; the server\'s status', () => {
    expect(text(h)).toContain('Coolers: TEST-COOLER-SN1');
    expect(text(h)).toContain('2.00 °C to 6.00 °C'); expect(text(h)).toContain('Logger LOG-TEST-1');
    expect(text(h)).toContain('the latest reading is inside the band');
  });
  it('each point by its source with BOTH times named', () => {
    expect((h.match(/data-kv-point="/g) ?? []).length).toBe(2);
    expect(text(h)).toContain('4.2 °C · from the logger · the device\'s time 2026-11-10 02:48 UTC · received by the server 2026-11-10 02:48 UTC · inside the band');
    expect(text(h)).toContain('6.9 °C · typed by a person · the time the person recorded it 2026-11-10 01:30 UTC · received by the server 2026-11-10 01:30 UTC · outside the band');
    expect(h).toContain('data-kv-point="manual"'); expect(h).toContain('data-kv-point="device"');
    expect(h).not.toContain('TYPED-REF-9');   // the typed reference is a label, never shown as a device
  });
  it('nothing is drawn between points: no svg, no canvas, no path; the page says so', () => {
    expect(/<svg|<canvas|<path|<polyline/.test(h)).toBe(false);
    expect(text(h)).toContain('Each reading is shown on its own; nothing is drawn or estimated between two readings.');
  });
  it('the breach rule as the server implements it (two signed readings in a row), and the breaches', () => {
    expect(text(h)).toContain('The server opens a breach when two signed readings from the logger in a row are outside the band; a reading typed by a person never opens one.');
    expect(text(h)).toContain('Opened 2026-11-08 05:10 UTC · peak 7.40 °C, above the band · 3 signed readings outside it. Closed 2026-11-08 06:00 UTC.');
    const noRule = page({ detail: { ...DETAIL, playbook: { ...DETAIL.playbook, rule: 'something_else' } } });
    expect(noRule).not.toContain('data-kv-statement="ops4.iot.breachRule"');
  });
  it('NO battery, NO calibration, NO cadence — even when the fixture carries them; no annotation; no "%"', () => {
    expect(/battery|calibrat|cadence|annotation/i.test(visible(h))).toBe(false);   // outside the refusal list, which names them to refuse them
    expect(h).not.toContain('57'); expect(h).not.toContain('2027-01-15');
    expect(FALSE_4C.test(affirmed(visible(h)))).toBe(false); expect(MATH_4A.test(visible(h))).toBe(false);
  });
  it('ONE input: the hours window, a GET form back to /iot/device keeping the subject', () => {
    expect((h.match(/<form/g) ?? []).length).toBe(1); expect(h).toMatch(/<form method="get" action="\/iot\/device"/);
    expect((h.match(/<select/g) ?? []).length).toBe(1); expect((h.match(/<input(?![^>]*type="hidden")/g) ?? []).length).toBe(0);
    expect(h).toContain('name="type" value="bmc_unit"'); expect(h).toContain(`name="id" value="${S_COOLER}"`);
    expect((h.match(/<option /g) ?? []).length).toBe(4); expect(h).toMatch(/<option value="48" selected=""/);
    expect(/method="post"/i.test(h)).toBe(false);
  });
  it('the states: not found, off, error with a re-read keeping the subject (W3326), trail paged', () => {
    expect(text(page({ state: 'notFound', detail: null }))).toContain('This subject is not shown');
    expect(page({ state: 'off', detail: null })).toContain('data-kv-off="logistics"');
    const err = page({ state: 'error', detail: null, hours: 24 });
    expect(err).toContain(`href="/iot/device?type=bmc_unit&amp;id=${S_COOLER}&amp;hours=24&amp;act=confirm"`);
    expect(text(page({ detail: { ...DETAIL, nextCursor: 'c' } }))).toContain('Only the latest 2 readings in this window are shown.');
    expect(text(page({ detail: { ...DETAIL, trail: [] } }))).toContain('No reading in the last 48 hours.');
  });
  it('the refusals by name; the source words in hi / gu', () => {
    for (const id of ['iot_battery', 'iot_calibration', 'iot_cadence', 'iot_alarm_minutes', 'iot_annotation', 'iot_line', 'iot_manual_protocol']) expect(h).toContain(`data-kv-refusal="${id}"`);
    for (const cat of [hi, gu]) { const x = text(page({}, cat)); expect(x).toContain(cat['ops4.iot.source.device']); expect(x).toContain(cat['ops4.iot.source.manual']); }
  });
});
