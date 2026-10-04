'use client';
// apps/web-tenant/src/app/me/security/TwoFactorPanel.tsx · the person's OWN TOTP 2FA (PC-56 TENANT-SW-c, founder decision: TOTP 2FA FOR
// STAFF). A client component for ONE reason (the 13a rule): the secret, the otpauth URI and the recovery codes arrive in a server
// action's RESPONSE and live in React state only — shown once, gone on navigation or reload; never in a URL, a cookie or storage.
// Enrol → scan / type the secret into an authenticator app → confirm with the current 6-digit code → the 10 recovery codes, once.
// Disable needs a current code or one recovery code.
import { useState, useTransition } from 'react';
import { confirmTwoFactorAction, disableTwoFactorAction, enrolTwoFactorAction } from './actions';

const fill = (s: string, v?: Record<string, string | number>) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);

export function TwoFactorPanel({ labels, confirmed, recoveryLeft }: { labels: Record<string, string>; confirmed: boolean; recoveryLeft: number }) {
  const L = (k: string, v?: Record<string, string | number>) => fill(labels[k] ?? labels['swc.code.unknown'] ?? k, v);
  const [step, setStep] = useState<'idle' | 'scan' | 'codes' | 'done' | 'disabled'>(confirmed ? 'done' : 'idle');
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const enrol = () => start(async () => {
    const r = await enrolTwoFactorAction();
    if (r.ok) { setSecret({ secret: r.secret, uri: r.otpauthUri }); setStep('scan'); setErrors([]); } else setErrors(r.codes);
  });
  const confirm = () => start(async () => {
    const r = await confirmTwoFactorAction(code);
    if (r.ok) { setCodes(r.recoveryCodes); setSecret(null); setStep('codes'); setErrors([]); setCode(''); } else setErrors(r.codes);
  });
  const disable = () => start(async () => {
    const r = await disableTwoFactorAction(code ? { code } : { recoveryCode: recovery });
    if (r.ok) { setStep('disabled'); setErrors([]); setCode(''); setRecovery(''); } else setErrors(r.codes);
  });

  return (
    <div className="kv-card">
      {errors.map((c) => <p key={c} className="kv-error" role="alert">{L(`swc.code.${c}`)}</p>)}
      {(step === 'idle' || step === 'disabled') && (
        <>
          <p>{L(step === 'disabled' ? 'swc.tfa.panel.disabled' : 'swc.tfa.panel.off')}</p>
          <button type="button" className="kv-btn kv-btn--primary" disabled={pending} onClick={enrol}>{L('swc.tfa.panel.enrol')}</button>
        </>
      )}
      {step === 'scan' && secret && (
        <>
          <p>{L('swc.tfa.panel.scan')}</p>
          <p><code className="kv-code">{secret.secret}</code></p>
          <p className="kv-field__hint"><code>{secret.uri}</code></p>
          <p className="kv-field__hint">{L('swc.tfa.panel.shownOnce')}</p>
          <label className="kv-field" htmlFor="tfa-code"><span>{L('swc.tfa.panel.code')}</span>
            <input id="tfa-code" className="kv-input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <button type="button" className="kv-btn kv-btn--primary" disabled={pending || !/^\d{6}$/.test(code)} onClick={confirm}>{L('swc.tfa.panel.confirm')}</button>
        </>
      )}
      {step === 'codes' && (
        <>
          <p><strong>{L('swc.tfa.panel.on')}</strong></p>
          <p>{L('swc.tfa.panel.recoveryOnce')}</p>
          <ul className="kv-list">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
          <button type="button" className="kv-btn" onClick={() => { setCodes([]); setStep('done'); }}>{L('swc.tfa.panel.saved')}</button>
        </>
      )}
      {step === 'done' && (
        <>
          <p><strong>{L('swc.tfa.panel.on')}</strong> · {L('swc.tfa.panel.recoveryLeft', { n: recoveryLeft })}</p>
          <details><summary>{L('swc.tfa.panel.disableTitle')}</summary>
            <label className="kv-field" htmlFor="tfa-dcode"><span>{L('swc.tfa.panel.code')}</span>
              <input id="tfa-dcode" className="kv-input" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></label>
            <label className="kv-field" htmlFor="tfa-drec"><span>{L('swc.tfa.panel.recovery')}</span>
              <input id="tfa-drec" className="kv-input" maxLength={20} value={recovery} onChange={(e) => setRecovery(e.target.value)} /></label>
            <button type="button" className="kv-btn" disabled={pending || (!/^\d{6}$/.test(code) && recovery.trim().length < 10)} onClick={disable}>{L('swc.tfa.panel.disable')}</button>
          </details>
        </>
      )}
    </div>
  );
}
