'use client';
// apps/web-partner/src/components/partner1/InviteChain.tsx · PC-56 PARTNER-1a · founder D5 — INVITE A COLLEAGUE: the REAL chain W3006 confirm →
// W3007 success → W3008 failure, over PARTNER-0's `POST /v1/partner/team/invites` (partner_admin only; the API decides).
//
// WHY A CLIENT COMPONENT: the invite CODE must never be in a URL, a cookie or storage. It arrives in the server action's RESPONSE and lives
// in React state only — shown once, gone on navigation or reload (the web-tenant CreateKeyChain precedent). The Idempotency-Key is minted
// by the SERVER at render and travels as a hidden field of the confirm step, so a double click or a retry of the same confirm cannot create
// two invites (a replay answers with no code — "already created; shown the first time"). `InviteChainView` is the pure markup of each step
// (the render test renders it); `InviteChain` holds the state.
import { useState, useTransition } from 'react';
import { formatDate } from '@krishalaya/i18n';
import { maskPhone } from '../../features/partner/mask';
import { PARTNER_ROLE_CODES, inviteErrorKey, roleKey, type InviteStep } from '../../features/partner1/settings';

export interface InviteResult { token: string | null; expiresAt: string; phoneMasked: string; roleCode: string }
export type InviteOutcome = { ok: true; result: InviteResult } | { ok: false; code: string };
export type InviteAction = (input: { phone: string; roleCode: string }, idempotencyKey: string) => Promise<InviteOutcome>;
type L = (key: string, vars?: Record<string, string | number>) => string;
const filler = (labels: Readonly<Record<string, string>>): L => (key, vars = {}) =>
  (labels[key] ?? key).replace(/\{(\w+)\}/g, (_m, n: string) => (n in vars ? String(vars[n]) : `{${n}}`));

export interface InviteViewProps {
  labels: Readonly<Record<string, string>>; lang: string; step: InviteStep; idempotencyKey: string;
  phone: string; roleCode: string; result: InviteResult | null; code: string | null; pending?: boolean;
  onPhone?: (v: string) => void; onRole?: (v: string) => void; onNext?: () => void; onProceed?: () => void; onBack?: () => void; onRetry?: () => void;
}

export function InviteChainView(p: InviteViewProps) {
  const L = filler(p.labels);
  if (p.step === 'confirm') {
    return (
      <div className="kv-card kv-chain" data-kv-invite="confirm" data-kv-canon="W3006">
        <h3>{L('partner1.invite.confirm.title')}</h3>
        <p>{L('partner1.invite.confirm.body', { phone: maskPhone(p.phone) ?? '', role: L(roleKey(p.roleCode)) })}</p>
        <form onSubmit={(e) => { e.preventDefault(); p.onProceed?.(); }} className="kv-form">
          <input type="hidden" name="idempotencyKey" value={p.idempotencyKey} />
          <button type="submit" className="kv-btn" disabled={p.pending}>{L('partner1.invite.confirm.proceed')}</button>{' '}
          <button type="button" className="kv-btn kv-btn--muted" onClick={() => p.onBack?.()}>{L('partner1.invite.confirm.cancel')}</button>
        </form>
      </div>
    );
  }
  if (p.step === 'success' && p.result) {
    const date = formatDate(p.result.expiresAt, p.lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
    return (
      <div className="kv-card kv-chain kv-success" data-kv-invite="success" data-kv-canon="W3007" role="status">
        <h3>{L('partner1.invite.success.title')}</h3>
        {p.result.token ? (
          <>
            <p>{L('partner1.invite.success.body', { phone: p.result.phoneMasked, date })}</p>
            <p><code className="kv-token" data-kv-token="once">{p.result.token}</code></p>
            <p className="kv-field__hint">{L('partner1.invite.success.sms')}</p>
          </>
        ) : <p data-kv-token="replayed">{L('partner1.invite.success.replayed')}</p>}
        <p className="kv-pager"><a className="kv-btn" href="/account/settings">{L('partner1.invite.success.done')}</a></p>
      </div>
    );
  }
  if (p.step === 'failure') {
    return (
      <div className="kv-card kv-chain" data-kv-invite="failure" data-kv-canon="W3008" data-kv-code={p.code ?? 'unknown'} role="alert">
        <h3>{L('partner1.invite.failure.title')}</h3>
        <p>{L(inviteErrorKey(p.code))}</p>
        <p className="kv-pager"><button type="button" className="kv-btn" onClick={() => p.onRetry?.()}>{L('partner1.invite.failure.retry')}</button></p>
      </div>
    );
  }
  return (
    <form className="kv-form kv-card" data-kv-invite="edit" onSubmit={(e) => { e.preventDefault(); p.onNext?.(); }}>
      <h3>{L('partner1.invite.title')}</h3>
      <label className="kv-field" htmlFor="p1-invite-phone"><span className="kv-field__label">{L('partner1.invite.phone')}</span>
        <input id="p1-invite-phone" name="phone" className="kv-input" type="tel" inputMode="tel" autoComplete="off" required value={p.phone} onChange={(e) => p.onPhone?.(e.target.value)} />
      </label>
      <label className="kv-field" htmlFor="p1-invite-role"><span className="kv-field__label">{L('partner1.invite.role')}</span>
        <select id="p1-invite-role" name="roleCode" className="kv-input" value={p.roleCode} onChange={(e) => p.onRole?.(e.target.value)}>
          {PARTNER_ROLE_CODES.map((r) => <option key={r} value={r}>{L(roleKey(r))}</option>)}
        </select>
      </label>
      <p className="kv-field__hint">{L('partner1.invite.seats')}</p>
      <button type="submit" className="kv-btn">{L('partner1.invite.next')}</button>
    </form>
  );
}

export function InviteChain({ labels, lang, idempotencyKey, invite }: { labels: Readonly<Record<string, string>>; lang: string; idempotencyKey: string; invite: InviteAction }) {
  const [step, setStep] = useState<InviteStep>('edit');
  const [phone, setPhone] = useState('');
  const [roleCode, setRole] = useState<string>('partner_viewer');
  const [result, setResult] = useState<InviteResult | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const proceed = () => start(async () => {
    const r = await invite({ phone, roleCode }, idempotencyKey);
    if (r.ok) { setResult(r.result); setStep('success'); } else { setCode(r.code); setStep('failure'); }
  });
  return (
    <InviteChainView labels={labels} lang={lang} step={step} idempotencyKey={idempotencyKey} phone={phone} roleCode={roleCode} result={result} code={code} pending={pending}
      onPhone={setPhone} onRole={setRole} onNext={() => setStep('confirm')} onProceed={proceed} onBack={() => setStep('edit')} onRetry={() => setStep('confirm')} />
  );
}
