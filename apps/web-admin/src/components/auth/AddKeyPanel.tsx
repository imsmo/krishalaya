'use client';
// apps/web-admin/src/components/auth/AddKeyPanel.tsx · PC-56 ADMIN-AUTH-1 — register ANOTHER key on your own account.
//
// admin-api demands a hardware-key session AND a fresh step-up for this (your existing key is the authority — a stolen IdP
// account alone can never add one). When the step-up is stale the options call is refused with 403 and this panel offers the
// "confirm with your key" screen, which brings the operator straight back here.
import { useEffect, useState } from 'react';
import { Button, Callout } from '@krishalaya/ui';
import { keyErrorKey } from '../../features/admin-auth/admin-auth';
import { postAction, registerKey } from './ceremony-client';

export function AddKeyPanel({ copy, stepUpHref }: { copy: Record<string, string>; stepUpHref: string }) {
  const [options, setOptions] = useState<unknown>(null);
  const [needsStepUp, setNeedsStepUp] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; key: string } | null>(null);

  async function load() {
    const r = await postAction('add-key-options', {});
    if (r.ok) { setOptions(r.data.options); setNeedsStepUp(false); }
    else if (r.status === 403) setNeedsStepUp(true);
    else setMsg({ tone: 'danger', key: keyErrorKey(r.code) });
  }
  useEffect(() => { void load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!options || !label.trim()) { setMsg({ tone: 'danger', key: 'loginKey.err.label' }); return; }
    setBusy(true); setMsg(null);
    const reg = await registerKey(options);
    if (!reg.ok) { setBusy(false); setMsg({ tone: 'danger', key: keyErrorKey(reg.code) }); setOptions(null); await load(); return; }
    const r = await postAction('add-key', { label: label.trim(), response: reg.response });
    setBusy(false);
    if (r.ok) { window.location.assign('/staff/keys?ok=keyAdded'); return; }
    if (r.status === 403) { setNeedsStepUp(true); return; }
    setMsg({ tone: 'danger', key: keyErrorKey(r.code) }); setOptions(null); await load();
  }

  if (needsStepUp) {
    return (
      <>
        <Callout tone="info">{copy['keys.add.needsStepUp']}</Callout>
        <p><Button as="a" href={stepUpHref}>{copy['stepUp.cta']}</Button></p>
      </>
    );
  }
  return (
    <form className="kv-form" onSubmit={(e) => void add(e)}>
      {msg ? <Callout tone={msg.tone} live="assertive">{copy[msg.key] ?? copy['loginKey.err.generic']}</Callout> : null}
      <label className="kv-field__label" htmlFor="kv-add-label">{copy['loginKey.labelLabel']}</label>
      <input className="kv-input" id="kv-add-label" required maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)}
        placeholder={copy['loginKey.labelPlaceholder']} />
      <Button type="submit" pending={busy || !options}>{copy[busy ? 'loginKey.touch' : 'keys.add.cta']}</Button>
    </form>
  );
}
