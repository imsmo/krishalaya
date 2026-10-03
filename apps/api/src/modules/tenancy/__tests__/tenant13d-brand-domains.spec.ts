// modules/tenancy/__tests__/tenant13d-brand-domains.spec.ts · PC-56 TENANT-13d · the pure rules of W191 / W192 (no DB).
//   • brand-rules: draft judgement (every refusal against its field), the contrast law as the API applies it (named pair + ratio),
//     the publish checks, the https logo URL for tenants.logo_url;
//   • logo-rules: PNG framing, the SVG allow-list (a script-bearing SVG is REFUSED by name; editor junk is stripped; entity tricks seen);
//   • domain-rules: hostname normalisation, the CNAME + TXT judgement (verified ONLY on both), DNS errors in words, platform hosts;
//   • the storefront's 301 rule (only to a primary whose certificate is issued);
//   • the state machines; the source pins (one contrast implementation; the domain service never sets `verified` itself).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_BRAND_COLOURS, brandContrast } from '@krishalaya/tokens';
import { defaultDraft, judgeDraft, contrastRefusals, publishRefusals, publicLogoUrl, draftDiff, brandReasonProblem } from '../domain/brand-rules';
import { judgeLogo, sanitiseSvg, judgePng, hasForeignUrl, LOGO_MAX_BYTES } from '../domain/logo-rules';
import { normaliseHost, judgeDns, dnsRecords, dnsErrorWords, newVerificationToken, isPlatformHost } from '../domain/domain-rules';
import { canMoveClaim, canMoveProposal, assertBrandProposalMove } from '../domain/brand-domain.state';
import { hostDecision } from '../controllers/v1/storefront-brand.controller';
import { UNWIRED_SETTINGS } from '../domain/setting-consumers';

const SRC = join(__dirname, '..');

function png(width: number, height: number, extra = Buffer.alloc(0)): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25); ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12);
  const iend = Buffer.alloc(12); iend.writeUInt32BE(0, 0); iend.write('IEND', 4, 'latin1');
  return Buffer.concat([sig, ihdr, iend, extra]);
}

describe('PC-56 TENANT-13d · brand rules', () => {
  it('the default draft is the tenant\'s own name on the platform colours, no logo, the mark shown', () => {
    const d = defaultDraft('Anand FPO Mandi');
    expect(d).toEqual({ displayName: 'Anand FPO Mandi', appShortName: 'Anand FPO Ma', logoMediaId: null, colours: { ...PLATFORM_BRAND_COLOURS }, poweredByHidden: false });
  });
  it('judges a draft edit: every refusal against its field, values normalised, absent fields kept', () => {
    const base = defaultDraft('Anand FPO');
    const r = judgeDraft(base, { displayName: 'A', appShortName: 'A very long short name', primaryColor: 'red', accentColor: '#F39C12', inkColor: '#1e6f3f;}', poweredByHidden: 'yes' as any, logoMediaId: 'nope' });
    expect(r.refusals.map((x) => [x.field, x.code])).toEqual([
      ['displayName', 'BRAND_NAME_TOO_SHORT'], ['appShortName', 'BRAND_SHORT_NAME_TOO_LONG'], ['logoMediaId', 'BRAND_LOGO_INVALID'],
      ['primaryColor', 'BRAND_COLOUR_INVALID'], ['inkColor', 'BRAND_COLOUR_INVALID'], ['poweredByHidden', 'BRAND_POWERED_BY_INVALID'],
    ]);
    expect(r.values.colours.accent).toBe('#f39c12');                // lower-cased
    expect(r.values.colours.primary).toBe(base.colours.primary);    // refused field keeps the current value
    expect(judgeDraft(base, { displayName: '<script>x</script>' }).refusals[0].code).toBe('BRAND_NAME_CHARACTERS');
  });
  it('the contrast law as the API applies it: a 4.4:1 pair is refused naming the pair and its ratio', () => {
    const failing = contrastRefusals(brandContrast({ ...PLATFORM_BRAND_COLOURS, primary: '#787878' }));
    expect(failing.map((f) => f.detail!.pair)).toEqual(['primary_on_surface', 'surface_on_primary']);
    expect(failing[0].detail).toMatchObject({ display: '4.4:1', min: 4.5 });
    expect(contrastRefusals(brandContrast(PLATFORM_BRAND_COLOURS))).toEqual([]);
  });
  it('publish checks: contrast + logo present and clean + the plan for hiding the mark', () => {
    const d = defaultDraft('Anand FPO');
    expect(publishRefusals(d, null, false).map((r) => r.code)).toEqual(['BRAND_LOGO_REQUIRED']);
    const withLogo = { ...d, logoMediaId: '01a10000-0000-7000-8000-000000000001' };
    expect(publishRefusals(withLogo, { ready: false, state: 'pending_scan' }, false).map((r) => r.code)).toEqual(['BRAND_LOGO_NOT_READY']);
    expect(publishRefusals({ ...withLogo, poweredByHidden: true }, { ready: true, state: 'clean' }, false).map((r) => r.code)).toEqual(['POWERED_BY_PLAN_REQUIRED']);
    expect(publishRefusals({ ...withLogo, poweredByHidden: true }, { ready: true, state: 'clean' }, true)).toEqual([]);
  });
  it('the diff names exactly what moved', () => {
    const a = defaultDraft('Anand FPO'); const b = { ...a, colours: { ...a.colours, accent: '#cc810b' }, displayName: 'Anand FPO Mandi' };
    expect(draftDiff(a, b)).toEqual([
      { field: 'displayName', before: 'Anand FPO', after: 'Anand FPO Mandi' }, { field: 'accentColor', before: '#f39c12', after: '#cc810b' },
    ]);
  });
  it('reasons 20–500; tenants.logo_url only ever an https URL (0075 CHECK)', () => {
    expect(brandReasonProblem('')).toBe('required'); expect(brandReasonProblem('short')).toBe('too_short'); expect(brandReasonProblem('x'.repeat(25))).toBeNull();
    expect(publicLogoUrl('https://api.krishalaya.app/', 't1', 3)).toBe('https://api.krishalaya.app/v1/storefront/branding/logo/t1/3');
    expect(publicLogoUrl('http://api.krishalaya.app', 't1', 3)).toBeNull();
    expect(publicLogoUrl('javascript:alert(1)', 't1', 3)).toBeNull();
  });
  it('the dead branding.* keys are deprecated in the registry list (never re-offered)', () => {
    for (const k of ['branding.display_name', 'branding.logo_url', 'branding.primary_color', 'branding.support_email']) expect(UNWIRED_SETTINGS[k]).toBe('deprecated_branding');
  });
});

describe('PC-56 TENANT-13d · logo rules', () => {
  it('PNG: square or wide, framed, ≤ 512 KB; trailing bytes after IEND are dropped', () => {
    const ok = judgePng(png(512, 256, Buffer.from('<?php evil ?>')));
    expect(ok).toMatchObject({ ok: true, mime: 'image/png', width: 512, height: 256, stripped: ['trailing_bytes'] });
    if (ok.ok) expect(ok.bytes.length).toBe(8 + 25 + 12);
    expect(judgePng(png(100, 200))).toMatchObject({ ok: false, code: 'LOGO_NOT_SQUARE_OR_WIDE' });
    expect(judgePng(png(900, 100))).toMatchObject({ ok: false, code: 'LOGO_NOT_SQUARE_OR_WIDE' });
    expect(judgePng(png(16, 16))).toMatchObject({ ok: false, code: 'LOGO_TOO_SMALL' });
    expect(judgePng(Buffer.from('GIF89a........................................'))).toMatchObject({ ok: false, code: 'LOGO_MALFORMED' });
    expect(judgeLogo(Buffer.alloc(LOGO_MAX_BYTES + 1), 'image/png')).toMatchObject({ ok: false, code: 'LOGO_TOO_LARGE' });
    expect(judgeLogo(png(64, 64), 'image/gif')).toMatchObject({ ok: false, code: 'LOGO_TYPE_UNSUPPORTED' });
    expect(judgeLogo(png(64, 64), 'image/svg+xml')).toMatchObject({ ok: false });   // the bytes decide, and they must agree with the type
  });
  it('a script-bearing SVG is REFUSED by name — script, handlers, foreignObject, javascript: URLs, external refs, entities', () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)">
      <script>alert(document.cookie)</script><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject>
      <a href="javascript:alert(1)"><rect width="10" height="10"/></a><use href="https://evil.example/x.svg#a"/>
      <rect fill="url(https://evil.example/p)" width="1" height="1"/><image href="data:image/png;base64,AAAA"/></svg>`;
    const r = sanitiseSvg(evil);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('LOGO_SVG_UNSAFE');
      expect(r.detail.found).toEqual(expect.arrayContaining(['doctype_or_entity', 'element:script', 'element:foreignobject', 'element:a', 'element:image',
        'attribute:onload', 'script_or_data_url', 'external_reference']));
    }
    // encoded tricks are decoded before judging
    expect(sanitiseSvg('<svg viewBox="0 0 10 10"><use href="&#106;avascript:alert(1)"/></svg>').ok).toBe(false);
    expect(sanitiseSvg('<svg viewBox="0 0 10 10"><style>@import url(https://x/y.css);</style></svg>').ok).toBe(false);
    expect(sanitiseSvg('<svg viewBox="0 0 10 10"><animate attributeName="href" to="javascript:alert(1)"/></svg>').ok).toBe(false);
    expect(sanitiseSvg('<svg viewBox="0 0 10 10"><set attributeName="onclick" to="x"/></svg>').ok).toBe(false);
  });
  it('a clean SVG is accepted, editor junk STRIPPED, internal references kept, dimensions read', () => {
    const src = `<?xml version="1.0" encoding="UTF-8"?><!-- Generator: Inkscape -->
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="200" height="100" viewBox="0 0 200 100" inkscape:version="1.2">
      <metadata><rdf:RDF/></metadata><defs><linearGradient id="g"><stop offset="0" stop-color="#1e6f3f"/></linearGradient></defs>
      <rect x="0" y="0" width="200" height="100" fill="url(#g)" data-name="bg"/><text x="10" y="50" font-size="20">Anand &amp; Co</text></svg>`;
    const r = judgeLogo(Buffer.from(src), 'image/svg+xml');
    expect(r).toMatchObject({ ok: true, mime: 'image/svg+xml', width: 200, height: 100 });
    if (r.ok) {
      const out = r.bytes.toString('utf8');
      expect(out).not.toMatch(/metadata|inkscape|data-name|<!--/);
      expect(out).toContain('fill="url(#g)"'); expect(out).toContain('<linearGradient id="g">'); expect(out).toContain('Anand &amp; Co');
      expect(r.stripped).toEqual(expect.arrayContaining(['comments', 'element:metadata', 'attribute:data-name', 'attribute:inkscape:*']));
    }
    expect(judgeLogo(Buffer.from('<svg viewBox="0 0 100 300"><rect width="1" height="1"/></svg>'), 'image/svg+xml')).toMatchObject({ ok: false, code: 'LOGO_NOT_SQUARE_OR_WIDE' });
    expect(judgeLogo(Buffer.from('<svg><rect width="1" height="1"/></svg>'), 'image/svg+xml')).toMatchObject({ ok: false, code: 'LOGO_NO_DIMENSIONS' });
    expect(judgeLogo(Buffer.from('<html><svg viewBox="0 0 1 1"/></html>'), 'image/svg+xml')).toMatchObject({ ok: false, code: 'LOGO_MALFORMED' });
  });
  it('url() is allowed only to a same-document #id', () => {
    expect(hasForeignUrl('url(#a)')).toBe(false); expect(hasForeignUrl("fill: url('#a'); stroke: url(#b)")).toBe(false);
    expect(hasForeignUrl('url(http://x)')).toBe(true); expect(hasForeignUrl('url( data:x )')).toBe(true); expect(hasForeignUrl('url(#a) url(')).toBe(true);
  });
});

describe('PC-56 TENANT-13d · domain rules', () => {
  it('normalises hostnames; refuses what cannot be routed', () => {
    expect(normaliseHost('  Mandi.AnandFPO.in. ')).toBe('mandi.anandfpo.in');
    for (const bad of ['localhost', 'nodot', '1.2.3.4', 'a..b.in', '-x.in', 'x_y.in', 'http://x.in', 'x.in/path', '']) expect(normaliseHost(bad)).toBeNull();
  });
  it('a token is 32 lower-case hex; the records are exactly CNAME → edge and TXT _krishalaya-verify', () => {
    const t = newVerificationToken(); expect(t).toMatch(/^[0-9a-f]{32}$/); expect(newVerificationToken()).not.toBe(t);
    expect(dnsRecords('mandi.anandfpo.in', 'edge.krishalaya.app', t)).toEqual([
      { type: 'CNAME', name: 'mandi.anandfpo.in', value: 'edge.krishalaya.app' },
      { type: 'TXT', name: '_krishalaya-verify.mandi.anandfpo.in', value: t },
    ]);
  });
  it('verified ONLY when the CNAME points at the edge AND the TXT carries the token; otherwise the reason in words', () => {
    const tok = 'a'.repeat(32);
    const ok = { cname: { values: ['Edge.Krishalaya.App.'], error: null }, txt: { values: [`junk`, tok], error: null } };
    expect(judgeDns('m.a.in', 'edge.krishalaya.app', tok, ok)).toEqual({ verified: true });
    expect(judgeDns('m.a.in', 'edge.krishalaya.app', tok, { ...ok, txt: { values: ['b'.repeat(32)], error: null } }))
      .toEqual({ verified: false, error: 'TXT at _krishalaya-verify.m.a.in does not contain the verification token' });
    expect(judgeDns('m.a.in', 'edge.krishalaya.app', tok, { ...ok, cname: { values: ['other.host'], error: null } }))
      .toEqual({ verified: false, error: 'CNAME for m.a.in points to other.host, not edge.krishalaya.app' });
    const none = judgeDns('m.a.in', 'edge.krishalaya.app', tok, { cname: { values: [], error: dnsErrorWords('ENOTFOUND') }, txt: { values: [], error: null } });
    expect(none).toEqual({ verified: false, error: 'CNAME for m.a.in: no such record (the name does not exist yet); no TXT record found at _krishalaya-verify.m.a.in' });
    expect(dnsErrorWords('ETIMEOUT')).toBe('the DNS lookup timed out');
  });
  it('platform hosts are never looked up (and so never 404)', () => {
    for (const h of ['localhost', 'localhost:3000', '127.0.0.1:4000', '[::1]:80', 'api.krishalaya.app', 'admin.x.in', 'edge.krishalaya.app', 'kr-api.svc', 'pod.cluster.local'])
      expect(isPlatformHost(h, [])).toBe(true);
    expect(isPlatformHost('store.krishalaya.app', ['store.krishalaya.app'])).toBe(true);
    for (const h of ['mandi.anandfpo.in', 'anand-fpo.krishalaya.app', 'www.anandfpo.in']) expect(isPlatformHost(h, ['store.krishalaya.app'])).toBe(false);
  });
  it('the 301 goes to the primary custom domain ONLY when its certificate is issued (else said, not done)', () => {
    const inc = { slug: 'anand', domainKind: 'included', isPrimary: false, primaryDomain: 'mandi.anandfpo.in', primaryKind: 'custom', primaryTls: 'pending' };
    expect(hostDecision('anand.krishalaya.app', inc)).toEqual({ tenant: { slug: 'anand' }, redirectTo: null, redirectBlockedBy: 'primary_certificate_not_issued' });
    expect(hostDecision('anand.krishalaya.app', { ...inc, primaryTls: 'issued' })).toEqual({ tenant: { slug: 'anand' }, redirectTo: 'https://mandi.anandfpo.in', redirectBlockedBy: null });
    expect(hostDecision('anand.krishalaya.app', { ...inc, isPrimary: true, primaryKind: 'included', primaryDomain: 'anand.krishalaya.app' }).redirectTo).toBeNull();
    expect(hostDecision('x.in', null)).toEqual({ tenant: null, redirectTo: null, redirectBlockedBy: null });
  });
});

describe('PC-56 TENANT-13d · state machines and source pins', () => {
  it('proposals: proposed → confirmed | refused | expired, and nothing leaves a closed state', () => {
    expect(canMoveProposal('proposed', 'confirmed')).toBe(true);
    expect(canMoveProposal('confirmed', 'refused')).toBe(false);
    expect(() => assertBrandProposalMove('refused', 'confirmed')).toThrow();
  });
  it('claims: pending/failed → verified | failed | expired; verified and expired are final', () => {
    expect(canMoveClaim('pending', 'verified')).toBe(true); expect(canMoveClaim('failed', 'verified')).toBe(true);
    expect(canMoveClaim('verified', 'failed')).toBe(false); expect(canMoveClaim('expired', 'pending')).toBe(false);
  });
  it('ONE contrast law: the API imports @krishalaya/tokens and carries no luminance code of its own', () => {
    const rules = readFileSync(join(SRC, 'domain/brand-rules.ts'), 'utf8');
    expect(rules).toContain("from '@krishalaya/tokens'");
    expect(rules).not.toMatch(/0\.2126|0\.7152|12\.92/);
  });
  it('the domain service never writes verified itself — only the repository act that sets app.domain_verifier (0194 admits no other)', () => {
    const svc = readFileSync(join(SRC, 'services/tenant-domain.service.ts'), 'utf8');
    expect(svc).not.toMatch(/verification_status\s*=\s*'verified'/);
    const repo = readFileSync(join(SRC, 'repositories/tenant-domain.repository.ts'), 'utf8');
    expect(repo.match(/SET verification_status = 'verified'/g)).toHaveLength(1);
    expect(repo).toContain("set_config('app.domain_verifier', 'dns', true)");
  });
  it('maker ≠ checker is the trigger\'s — neither confirm() compares proposer and confirmer in TypeScript', () => {
    for (const f of ['services/tenant-branding.service.ts', 'services/tenant-domain.service.ts']) {
      const s = readFileSync(join(SRC, f), 'utf8');
      const confirm = s.slice(s.indexOf('async confirm('), s.indexOf('async refuse('));
      expect(confirm).not.toMatch(/proposedBy\s*===\s*actor\.userId|proposedBy\s*!==\s*actor\.userId/);
    }
  });
});
