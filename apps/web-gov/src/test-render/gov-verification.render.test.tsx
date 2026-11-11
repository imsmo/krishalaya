// apps/web-gov/src/test-render/gov-verification.render.test.tsx · PC-56 GOV-4a — W335 (`/verification`, "Field visits") as a person sees it: Q2's,
// Q1's, Q3's and Q5's sentences and the download sentence verbatim; "What this console does not do" (W335's acts, W336, W337, W338 in plain
// words); no row, table, count, farmer, village, officer, position, picture, recording, phone, document, figure, form, button or file — and a
// SENTINEL: a fixture loaded with a farm's coordinates, a picture link, a farmer's phone, a document and an officer's tally, handed to the view
// every way it could be (inside `me`, as extra props), never reaches the markup, in en, hi and gu. The refusals BY NAME ×3.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VerificationView } from '../components/gov4/VerificationViews';
import { gov4RefusalKeys, GOV4_NOT_DONE } from '../features/gov4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_OFFICER, text, tr, visible } from './gov1a-fixtures';

const Q2 = 'Field visits are not scheduled or recorded on this platform. Checking an application here is a desk check, not a visit to the farm.';
const Q1 = 'This console never shows where a farm is, photos or videos from a farm, identity or land documents, or a farmer\'s phone number.';
const Q3 = 'This console does not rank, flag or score officials.';
const Q5 = 'A field visit changes no payment. Benefits are paid by PFMS and the banks, outside this platform.';
const DL = 'Nothing on this page can be downloaded.';
/** W335–W338's false words as they would appear in VISIBLE text (outside the refusal list and the "does not do" section and Q1/Q3). */
export const FALSE_4A = /₹|%|\bINR\b|rupee|crore|instal?ment|verified|verification|geotag|\bGPS\b|\bwalk|\btrace\b|polygon|parcel|\bOTP\b|\bbeat|taluka|supervisor|coaching|workload|fairness|re-?check|\bkm\b|offline|\bsync|draft|batch|export|audit|7\/12|Directorate|Gujarat|Junagadh|Bhesan|Vanthali|Keshod|Chauhan|Damor|Solanki|Rathva|GM26-|SR-JND|\+91|DELTA-\d/i;

/** The SENTINEL: every kind of thing Q1-A and Q3-A say this console never shows, in one fixture. */
const SENTINEL = {
  lat: '21.4712', lng: '70.3301', photo: 'https://media.test/farm-sentinel-photo.jpg', video: 'https://media.test/farm-sentinel-video.mp4',
  phone: '+919876500214', phoneTail: '••214', document: 'land-sentinel-record-51-2.pdf', officer: 'Sentinel Officer', officerVisits: '34',
};
const SENTINEL_STRINGS = Object.values(SENTINEL);
const ME_LOADED = { ...ME_OFFICER, farm: { lat: SENTINEL.lat, lng: SENTINEL.lng }, photoUrl: SENTINEL.photo, videoUrl: SENTINEL.video, phone: SENTINEL.phone,
  person: { ...ME_OFFICER.person, phoneMasked: SENTINEL.phoneTail }, document: SENTINEL.document, leaderboard: [{ name: SENTINEL.officer, visits: SENTINEL.officerVisits }] };
const EXTRA = { visits: [{ geotag: [{ lat: SENTINEL.lat, lng: SENTINEL.lng, mediaId: SENTINEL.photo }], walkTrace: SENTINEL.video, phone: SENTINEL.phone, officer: SENTINEL.officer }], documents: [SENTINEL.document] };

const CATS = { en, hi, gu } as const;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const view = (cat: Record<string, string> = en, me: any = ME_OFFICER, extra: Record<string, unknown> = {}) => renderToStaticMarkup(<VerificationView t={tr(cat)} me={me} {...(extra as object)} />);
const withoutNotDone = (h: string) => visible(h.replace(/<section class="kv-card" data-kv-not-done=""[\s\S]*?<\/section>/g, ''));

describe('PC-56 GOV-4a · W335 /verification — field visits are not done here, said truly', () => {
  it('the four sentences and the download sentence verbatim, each once; the authority named; signed in as you', () => {
    const h = view(); const t = text(h);
    for (const q of [Q2, Q1, Q3, Q5, DL]) expect([q, t.split(q).length - 1]).toEqual([q, 1]);
    for (const k of ['gov4.q2', 'gov4.q1', 'gov4.q3', 'gov4.q5', 'gov4.download']) expect(h).toContain(`data-kv-statement="${k}"`);
    expect(t).toContain('Signed in as you, in Test Authority One.'); expect(t).toContain('Field visits');
    expect(t.indexOf(Q2)).toBeLessThan(t.indexOf(Q1));
  });
  it('"What this console does not do": W335\'s acts, W336, W337 and W338 in plain words, each once', () => {
    const h = view(); const t = text(h);
    expect(h).toContain('data-kv-not-done=""'); expect(t).toContain('What this console does not do');
    for (const n of GOV4_NOT_DONE) { expect(h).toContain(`data-kv-not-done-item="${n.id}"`); expect([n.id, t.split(en[n.key]).length - 1]).toEqual([n.id, 1]); }
    expect(t).toContain('No field visit is planned or given a date from this console.');
    expect(t).toContain('Nothing seen at a farm is entered here: no measurement, picture, recording or position.');
    expect(t).toContain('No code is sent to a farmer, and no farmer confirms or disputes a field visit through this console.');
    expect(t).toContain('No officer\'s number of visits, distance travelled or results are counted or compared here.');
  });
  it('no row, table, list of visits, count, form, button, file link or image; no false canon word in visible text; no digit at all', () => {
    const h = view();
    expect(h).not.toMatch(/<table|<tr|<td|<form|<input|<button|<select|<img|<video|<svg|download=|\.csv|\.pdf|do=file|do=act|do=draft/i);
    expect(FALSE_4A.test(withoutNotDone(h).replace(Q1, '').replace(Q3, ''))).toBe(false);
    expect(/\d/.test(text(h))).toBe(false);   // no count, figure, date, distance or coordinate is printed
    expect([...h.matchAll(/<a /g)].length).toBe(0);
  });
  it.each(Object.entries(CATS))('%s: the SENTINEL (coordinates, picture, recording, phone, document, officer tally) never reaches the markup', (_l, cat) => {
    for (const h of [view(cat, ME_LOADED), view(cat, ME_LOADED, EXTRA), view(cat, ME_OFFICER, EXTRA)]) {
      for (const s of SENTINEL_STRINGS) expect([s, h.includes(s)]).toEqual([s, false]);
      expect(h).not.toMatch(/\d{2}\.\d{3,}|\+?\d{10,}|https?:\/\//);   // no coordinate-, phone- or link-shaped string
    }
  });
  it.each(Object.entries(CATS))('%s: the refusals BY NAME, the sentences, every key resolved', (_l, cat) => {
    const c = cat as Record<string, string>;
    const t = text(view(c));
    for (const k of gov4RefusalKeys('verification')) expect([k, t.includes(c[k])]).toEqual([k, true]);
    for (const k of ['gov4.q2', 'gov4.q1', 'gov4.q3', 'gov4.q5', 'gov4.download', 'gov4.notDone.title', 'gov4.verification.title']) expect([k, t.includes(c[k])]).toEqual([k, true]);
    expect(/gov4\.|gov3\.|gov2\.|gov1\.|common\./.test(t)).toBe(false);
  });
});
