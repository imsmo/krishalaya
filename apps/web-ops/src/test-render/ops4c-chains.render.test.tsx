// apps/web-ops/src/test-render/ops4c-chains.render.test.tsx · PC-56 OPS-4c — the two sensor chains in every state, PARITY-DECOR:
//   iot mutate (W3326–W3328), opened by "Retry sync" on W400 and "Retry" on W401: "sync" refused by name; the confirm state's one link IS a re-read of
//   the page that opened it; Back → that page (W400, or W401 KEEPING its subject).
//   device mutate (W3307–W3309), opened by "Retry" on W404: Back → /iot/device-health.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops4Chain } from '../components/ops4/Ops4Chain';
import { OPS4_CHAINS } from '../features/ops4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { affirmed } from './ops4a-fixtures';
import { FALSE_4C, S_COOLER } from './ops4c-fixtures';

const W401 = `/iot/device?type=bmc_unit&id=${S_COOLER}`;
const OPENERS: ReadonlyArray<['iot_act' | 'device_act', string]> = [['iot_act', '/iot/dashboard'], ['iot_act', W401], ['device_act', '/iot/device-health']];

describe('PC-56 OPS-4c · the iot and device mutate chains (PARITY-DECOR)', () => {
  for (const [chain, opener] of OPENERS) {
    describe(`${chain} opened from ${opener}`, () => {
      it.each(['confirm', 'success', 'failure'])('%s: PARITY-DECOR, the statement, Back → the page that opened it; no control', (st) => {
        const h = renderToStaticMarkup(<Ops4Chain t={tr(en)} chain={chain} state={st} page={opener} />);
        expect(h).toContain(`data-kv-chain="${chain}" data-kv-chain-kind="PARITY-DECOR" data-kv-chain-state="${st}"`);
        expect(h).toContain(`data-kv-back="${opener.replace(/&/g, '&amp;')}"`);
        expect((h.match(/data-kv-back="/g) ?? []).length).toBe(1);
        if (opener !== '/iot/dashboard') expect(h).not.toContain('data-kv-back="/iot/dashboard"');
        expect(text(h)).toContain('These sensor pages only read: nothing is changed here.');
        expect(/<form|<input|<button|<select/.test(h)).toBe(false);
        // the confirm state's ONE link is the re-read of the opener
        if (st === 'confirm') expect(h).toContain(`data-kv-real="reread"`); else expect(h).not.toContain('data-kv-real="reread"');
        expect(FALSE_4C.test(affirmed(visible(h)))).toBe(false);
        expect(/zero-sum|audit[- ]trail|on-call/i.test(text(h))).toBe(false);
      });
    });
  }
  it('"sync" and the chains\' zero-sum / audit / on-call sentences are refused BY NAME', () => {
    const iot = renderToStaticMarkup(<Ops4Chain t={tr(en)} chain="iot_act" state="success" page="/iot/dashboard" />);
    for (const id of ['iot_sync', 'iot_confirm_audit', 'iot_zero_sum', 'iot_on_call']) expect(iot).toContain(`data-kv-refusal="${id}"`);
    expect(text(iot)).toContain('Nothing syncs: Retry reads the page again.');
    const dev = renderToStaticMarkup(<Ops4Chain t={tr(en)} chain="device_act" state="failure" page="/iot/device-health" />);
    for (const id of ['device_confirm_audit', 'device_zero_sum', 'device_on_call']) expect(dev).toContain(`data-kv-refusal="${id}"`);
  });
  it('every state renders its own title in hi / gu', () => {
    for (const c of OPS4_CHAINS.filter((x) => x.wave === '4c')) for (const cat of [hi, gu]) for (const st of c.states)
      expect(text(renderToStaticMarkup(<Ops4Chain t={tr(cat)} chain={c.id} state={st} page="/iot/dashboard" />))).toContain(cat[`${c.key(st)}.title`]);
  });
});
