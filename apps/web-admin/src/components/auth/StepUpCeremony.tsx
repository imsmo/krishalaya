'use client';
// apps/web-admin/src/components/auth/StepUpCeremony.tsx · PC-56 ADMIN-AUTH-1 — "confirm with your key".
//
// A sensitive admin-api route refused with 403 because the last strong re-auth is older than ADMIN_STEP_UP_MAX_AGE_SEC. This
// runs one WebAuthn assertion; admin-api answers a fresh token for the SAME session (new auth_time), which our route handler
// stores in the httpOnly cookie, and the operator goes back to the page they were on to retry.
import { useEffect, useState } from 'react';
import { Button, Callout } from '@krishalaya/ui';
import { keyErrorKey } from '../../features/admin-auth/admin-auth';
import { assertWithKey, postAction } from './ceremony-client';

export function StepUpCeremony({ next, copy }: { next: string; copy: Record<string, string> }) {
  const [options, setOptions] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);

  async function load() {
    const r = await postAction('step-up-options', {});
    if (r.ok) setOptions(r.data.options); else { setFatal(true); setErrorKey(r.status === 401 ? 'stepUp.err.session' : keyErrorKey(r.code)); }
  }
  useEffect(() => { void load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  async function confirm() {
    if (!options) return;
    setBusy(true); setErrorKey(null);
    const a = await assertWithKey(options);
    if (!a.ok) { setBusy(false); setErrorKey(keyErrorKey(a.code)); setOptions(null); await load(); return; }
    const r = await postAction('step-up', { response: a.response, next });
    if (r.ok && typeof r.data.redirect === 'string') { window.location.assign(r.data.redirect); return; }
    setBusy(false);
    setErrorKey(r.ok ? 'loginKey.err.generic' : r.status === 401 || r.status === 403 ? 'stepUp.err.session' : keyErrorKey(r.code));
    setOptions(null); await load();
  }

  return (
    <>
      {errorKey ? <Callout tone="danger" live="assertive">{copy[errorKey] ?? copy['loginKey.err.generic']}</Callout> : null}
      {fatal ? (
        <p className="kv-login__cta"><Button as="a" href="/login">{copy['loginKey.startAgain']}</Button></p>
      ) : (
        <p className="kv-login__cta">
          <Button type="button" pending={busy || !options} onClick={() => void confirm()}>{copy[busy ? 'loginKey.touch' : 'stepUp.cta']}</Button>
        </p>
      )}
    </>
  );
}
