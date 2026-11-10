// apps/web-ops/src/test-render/chc-maintenance.render.test.tsx · PC-56 OPS-4b · W408 `/chc/maintenance` — the signed-in person's machines' maintenance
// entries (type in words, day, cost "as entered", engine hours as typed) and the server's alerts for HER machines, in words; the facts the code
// proves; THE ONE FORM ("Record a maintenance entry", five inputs, counted); never the typed note (a fixture carries a person's name in it), never
// another person's machine's alert; no %, days down, real rent, odometer, technician or completion affirmed; every refusal printed BY NAME.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MaintenanceView } from '../components/ops4/UpkeepViews';
import { OPS4_REFUSALS } from '../features/ops4/refusals';
import { en } from '../i18n/en';
import { text, tr, visible } from './ops1a-fixtures';
import { A1, A_OTHER, CATEGORIES, FALSE_4A, MACHINES, MATH_4A, affirmed } from './ops4a-fixtures';
import { ALERTS, ENTRIES, FALSE_4B, PERSON_IN_NOTE } from './ops4b-fixtures';

const ok = renderToStaticMarkup(<MaintenanceView t={tr(en)} lang="en" state="ok" machines={MACHINES} machinesMore={false} categories={CATEGORIES} entries={ENTRIES} alerts={ALERTS} />);

describe('PC-56 OPS-4b · chc-maintenance (W408)', () => {
  it('the facts the code proves, exactly', () => {
    for (const s of ['Signed in as you. This page shows the machines you listed and their maintenance entries.',
      'Only the machine\'s owner records its maintenance. Each entry is recorded.',
      'A maintenance entry does not take a machine off hire: it does not change the machine\'s status.',
      'While a machine\'s status is in maintenance, no new hire can be requested for it.',
      'Costs and engine hours in an entry are typed by the machine\'s owner; nothing here is measured.']) expect(text(ok)).toContain(s);
  });
  it('each entry: type in words, the day, engine hours as typed, the cost as entered through the money formatter — never the note', () => {
    expect(text(ok)).toContain('Repair · 2026-10-20 · at 1200.5 engine hours, as typed · cost ₹4,111.50, as typed');
    expect(text(ok)).toContain('Breakdown · 2026-09-02');
    expect(ok).not.toContain(PERSON_IN_NOTE); expect(ok).not.toContain('fixed by');
    expect(text(ok)).toContain('A note typed with an entry is not shown on this console.');
    expect(ok).toContain(`data-kv-machine="${A1}"`); expect(ok).toContain('data-kv-edge="W406"');
  });
  it('the server\'s alerts for HER machines in words; another person\'s machine never appears', () => {
    expect(text(ok)).toContain('its latest entry is a breakdown'); expect(text(ok)).toContain('no service or inspection recorded in the last 365 days');
    expect((ok.match(/data-kv-alert=/g) ?? []).length).toBe(2); expect(ok).not.toContain(A_OTHER);
  });
  it('THE FORM, counted: one form (GET → the review), five inputs (machine, type, day, cost, hours) + the state field; "Record a maintenance entry", never "Log completion"', () => {
    expect((ok.match(/<form/g) ?? []).length).toBe(1);
    expect(ok).toContain(`action="/chc/maintenance"`); expect(ok).toMatch(/<form method="get"/);
    expect((ok.match(/<select/g) ?? []).length).toBe(2);
    expect((ok.match(/<input(?![^>]*type="hidden")/g) ?? []).length).toBe(3);
    expect((ok.match(/<input[^>]*type="hidden"[^>]*>/g) ?? [])).toEqual(['<input type="hidden" name="form" value="review"/>']);
    expect(text(ok)).toContain('Record a maintenance entry'); expect(/log completion/i.test(text(ok))).toBe(false);
    expect((ok.match(/<textarea/g) ?? []).length).toBe(0);   // no free-text note is offered
  });
  it('no canon false word affirmed; no arithmetic', () => {
    expect(FALSE_4B.test(affirmed(visible(ok)))).toBe(false); expect(FALSE_4A.test(affirmed(visible(ok)))).toBe(false);
    expect(MATH_4A.test(visible(ok))).toBe(false); expect(/days down|real rent/i.test(visible(ok))).toBe(false);
  });
  it('every W408 refusal printed BY NAME (the console chrome\'s too)', () => {
    const ids = OPS4_REFUSALS.filter((r) => r.surfaces.includes('chc_maintenance')).map((r) => r.id);
    for (const id of ['days_down', 'preventive_pct', 'real_rent', 'off_calendar', 'log_completion', 'odometer_sync', 'technician_only', 'chc_manager', 'chrome_counts']) expect(ids).toContain(id);
    for (const id of ids) expect([id, ok.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
  });
  it('the switched-off and could-not-read states: no form; Retry opens the re-read chain', () => {
    const off = renderToStaticMarkup(<MaintenanceView t={tr(en)} lang="en" state="off" machines={[]} machinesMore={false} categories={[]} entries={{}} alerts={[]} />);
    const err = renderToStaticMarkup(<MaintenanceView t={tr(en)} lang="en" state="error" machines={[]} machinesMore={false} categories={[]} entries={{}} alerts={[]} />);
    expect(text(off)).toContain('Machine hire is switched off'); expect(err).toContain('href="/chc/maintenance?act=confirm"');
    for (const h of [off, err]) expect(/<form|<input|<select/.test(h)).toBe(false);
  });
  it('no machine listed → no form; failed reads are named, not hidden', () => {
    const none = renderToStaticMarkup(<MaintenanceView t={tr(en)} lang="en" state="ok" machines={[]} machinesMore={false} categories={[]} entries={{}} alerts={[]} />);
    expect(/<form/.test(none)).toBe(false);
    const failed = renderToStaticMarkup(<MaintenanceView t={tr(en)} lang="en" state="ok" machines={MACHINES} machinesMore categories={CATEGORIES} entries={{ [A1]: null }} alerts={null} />);
    expect(failed).toContain('data-kv-error="alerts"'); expect(failed).toContain('data-kv-error="entries"'); expect(failed).toContain('data-kv-note="machines-more"');
  });
});
