'use client';
// apps/web-tenant/src/app/people/RevealField.tsx · W153's "full reveal is per-field, recorded, and reasoned" as a
// control a staff member actually operates (PC-56 TENANT-1b).
//
// **THIS IS THE ONE CLIENT COMPONENT ON THE ROSTER, AND THE REASON IS THE VALUE'S LIFETIME.** A revealed phone number
// must live in memory for as long as the person is reading it and no longer: not in a URL (history, referrer, proxy
// logs), not in a cookie, not in a server-rendered payload a CDN might hold. React state gives exactly that — the value
// vanishes on navigation, on reload, and when the disclosure is closed.
//
// **THE CONTROL IS CLOSED BY DEFAULT AND THE REASON FIELD IS PART OF IT, NOT A CONFIRMATION AFTERWARDS.** There is no
// "show PII" toggle: a field is chosen, a reason is typed, and only then is anything requested. That ordering is what
// makes the audit row meaningful — the reason exists before the value does.
import { useState, useTransition } from 'react';
import { REVEALABLE_MEMBER_FIELDS } from '@krishalaya/sdk-js';
import { MIN_REVEAL_REASON } from '../../features/people/roster';
import { revealFieldAction, type RevealResult } from './actions';

export interface RevealFieldProps {
  userId: string;
  name: string;
  /** Translated strings, passed in: this is a client component and the console's translator is server-only. */
  labels: {
    open: string;
    heading: string;
    field: string;
    fieldOption: Record<string, string>;
    reason: string;
    reasonHint: string;
    submit: string;
    working: string;
    hide: string;
    empty: string;
    recorded: string;
    error: Record<string, string>;
  };
}

export function RevealField({ userId, name, labels }: RevealFieldProps) {
  const [result, setResult] = useState<RevealResult | null>(null);
  const [pending, start] = useTransition();
  const [field, setField] = useState<string>(REVEALABLE_MEMBER_FIELDS[0]);
  const [reason, setReason] = useState('');

  // Client-side length check only so the staff member learns the rule before losing their typing. The SERVER enforces
  // it — this branch disappearing would not open the control.
  const reasonOk = reason.trim().length >= MIN_REVEAL_REASON;

  return (
    <details className="kv-disclosure">
      <summary className="kv-btn--link">{labels.open}</summary>
      <form
        className="kv-form"
        onSubmit={(e) => {
          e.preventDefault();
          // Clear any previous value BEFORE the new request: leaving the last member's number on screen while a fresh
          // reveal is in flight is how the wrong number gets read out over the phone.
          setResult(null);
          start(async () => setResult(await revealFieldAction(userId, field, reason)));
        }}
      >
        <p className="kv-fine">{labels.heading.replace('{name}', name)}</p>

        <label htmlFor={`f-${userId}`} className="kv-field__label">{labels.field}</label>
        <select id={`f-${userId}`} className="kv-select" value={field} onChange={(e) => setField(e.target.value)}>
          {/* Rendered FROM the SDK's exported constant, so the picker cannot drift from the server's closed enum.
              `aadhaar_vault_ref` is not on that list and so cannot appear here. */}
          {REVEALABLE_MEMBER_FIELDS.map((f) => (
            <option key={f} value={f}>{labels.fieldOption[f] ?? f}</option>
          ))}
        </select>

        <label htmlFor={`r-${userId}`} className="kv-field__label">{labels.reason}</label>
        <textarea
          id={`r-${userId}`} className="kv-textarea" rows={2} value={reason} required
          minLength={MIN_REVEAL_REASON} onChange={(e) => setReason(e.target.value)}
          aria-describedby={`rh-${userId}`}
        />
        <p id={`rh-${userId}`} className="kv-field__hint">{labels.reasonHint}</p>

        <button type="submit" className="kv-btn" disabled={pending || !reasonOk}>
          {pending ? labels.working : labels.submit}
        </button>
      </form>

      {result?.ok && (
        <p className="kv-notice" role="status">
          {/* `null` is a real answer: this member has nothing on file for that field. */}
          <strong>{result.value ?? labels.empty}</strong>
          {' '}
          {/* The screen says the reveal was recorded, because a staff member who knows it was recorded behaves
              differently from one who assumes nobody is watching. That is the control working. */}
          <span className="kv-fine">{labels.recorded}</span>
          {' '}
          <button type="button" className="kv-btn--link" onClick={() => setResult(null)}>{labels.hide}</button>
        </p>
      )}
      {result && !result.ok && (
        <p className="kv-error" role="alert">{labels.error[result.error] ?? labels.error.failed}</p>
      )}
    </details>
  );
}
