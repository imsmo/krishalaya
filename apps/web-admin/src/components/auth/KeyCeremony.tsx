'use client';
// apps/web-admin/src/components/auth/KeyCeremony.tsx · PC-56 ADMIN-AUTH-1 — the second factor: the hardware key.
//
// Arrives with a single-use ticket (≤ 5 min) from admin-api's IdP callback. Fetches what to do on mount — authenticate with an
// existing key, or enroll a first one — so the button press itself runs the browser ceremony straight away (Safari only
// allows navigator.credentials inside the user's gesture, with no network round trip in between). Copy comes resolved from
// the server page (i18n catalogue); this component holds no literals.
import { useEffect, useState } from 'react';
import { Button, Callout } from '@krishalaya/ui';
import { enrollFormProblem, keyErrorKey } from '../../features/admin-auth/admin-auth';
import { assertWithKey, postAction, registerKey } from './ceremony-client';

export type KeyCopy = Record<string, string>;

type Phase =
  | { kind: 'loading' }
  | { kind: 'authenticate'; options: unknown }
  | { kind: 'enroll'; options: unknown }
  | { kind: 'busy' }
  | { kind: 'enrolled'; options: unknown }
  | { kind: 'fatal'; errorKey: string };

export function KeyCeremony({ ticket, copy }: { ticket: string; copy: KeyCopy }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');

  async function loadOptions(after?: 'enrolled') {
    const r = await postAction('key-options', { ticket });
    if (!r.ok) { setPhase({ kind: 'fatal', errorKey: keyErrorKey(r.code) }); return; }
    const mode = r.data.mode === 'enroll' ? 'enroll' : 'authenticate';
    if (after === 'enrolled' && mode === 'authenticate') setPhase({ kind: 'enrolled', options: r.data.options });
    else setPhase({ kind: mode, options: r.data.options });
  }

  useEffect(() => { void loadOptions(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  async function signIn(options: unknown) {
    setErrorKey(null);
    setPhase({ kind: 'busy' });
    const a = await assertWithKey(options);
    if (!a.ok) { setErrorKey(keyErrorKey(a.code)); await loadOptions(); return; }
    const r = await postAction('key-login', { ticket, response: a.response });
    if (r.ok && typeof r.data.redirect === 'string') { window.location.assign(r.data.redirect); return; }
    const k = keyErrorKey(r.ok ? 'AUTH_REFUSED' : r.code);
    if (!r.ok && (r.code === 'AUTH_TICKET_INVALID' || r.status === 403)) { setPhase({ kind: 'fatal', errorKey: k }); return; }
    setErrorKey(k);
    await loadOptions();
  }

  async function enroll(options: unknown) {
    setErrorKey(null);
    const problem = enrollFormProblem(code, label);
    if (problem) { setErrorKey(problem); return; }
    setPhase({ kind: 'busy' });
    const reg = await registerKey(options);
    if (!reg.ok) { setErrorKey(keyErrorKey(reg.code)); await loadOptions(); return; }
    const r = await postAction('key-enroll', { ticket, code, label: label.trim(), response: reg.response });
    if (!r.ok) {
      if (r.code === 'AUTH_TICKET_INVALID') { setPhase({ kind: 'fatal', errorKey: keyErrorKey(r.code) }); return; }
      setErrorKey(keyErrorKey(r.code));
      await loadOptions();
      return;
    }
    setCode('');
    await loadOptions('enrolled');
  }

  const err = errorKey ? <Callout tone="danger" live="assertive">{copy[errorKey] ?? copy['loginKey.err.generic']}</Callout> : null;

  if (phase.kind === 'fatal') {
    return (
      <>
        <Callout tone="danger" live="assertive">{copy[phase.errorKey] ?? copy['loginKey.err.generic']}</Callout>
        <p className="kv-login__cta"><Button as="a" href="/login">{copy['loginKey.startAgain']}</Button></p>
      </>
    );
  }
  if (phase.kind === 'loading' || phase.kind === 'busy') {
    return <p className="kv-muted" role="status" aria-live="polite">{copy[phase.kind === 'busy' ? 'loginKey.touch' : 'loginKey.loading']}</p>;
  }
  if (phase.kind === 'authenticate' || phase.kind === 'enrolled') {
    const options = phase.options;
    return (
      <>
        {phase.kind === 'enrolled' ? <Callout tone="success" live="polite">{copy['loginKey.enrolled']}</Callout> : null}
        {err}
        <p>{copy['loginKey.authLead']}</p>
        <p className="kv-login__cta"><Button type="button" onClick={() => void signIn(options)}>{copy['loginKey.authCta']}</Button></p>
      </>
    );
  }
  const options = phase.options;
  return (
    <>
      <p>{copy['loginKey.enrollLead']}</p>
      <Callout tone="info">{copy['loginKey.enrollPin']}</Callout>
      {err}
      <form className="kv-form" onSubmit={(e) => { e.preventDefault(); void enroll(options); }}>
        <label className="kv-field__label" htmlFor="kv-enroll-code">{copy['loginKey.codeLabel']}</label>
        <input className="kv-input" id="kv-enroll-code" name="code" autoComplete="one-time-code" required minLength={8} maxLength={80}
          value={code} onChange={(e) => setCode(e.target.value)} />
        <span className="kv-field__hint">{copy['loginKey.codeHint']}</span>
        <label className="kv-field__label" htmlFor="kv-enroll-label">{copy['loginKey.labelLabel']}</label>
        <input className="kv-input" id="kv-enroll-label" name="label" required maxLength={60}
          value={label} onChange={(e) => setLabel(e.target.value)} placeholder={copy['loginKey.labelPlaceholder']} />
        <Button type="submit">{copy['loginKey.enrollCta']}</Button>
      </form>
    </>
  );
}
