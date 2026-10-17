// apps/web-storefront/src/features/store6b/keeper.ts · PC-56 STORE-6b · D4 — THE KEEPER'S LOGIC, framework-free: what is read from a form, what
// is written back into it, the debounce, and the start-up order (sweep → done? → fill). components/drafts/DraftKeeper.tsx wires it to the real
// form and IndexedDB; test/store6b-keeper.spec.ts drives it with DOM doubles (jsdom is not installed in this repo).
//
// The keeper reads ONLY the named visible fields of its kind — `body` (a message); `stars`, every `dim.<code>` radio and `body` (a review) — and
// NEVER an element of type `hidden` (`slug`, `id`, `key`, `conversationId` are the form's, not the person's words: the draft carries only its
// `ref`). Every value passes `safeFields` (text only, the live limits, nothing token-shaped) or nothing is written.
import {
  type Draft, type DraftFields, type DraftKind, type DraftStore, type ReviewDraftFields,
  safeFields, isEmptyFields, runSweep, draftState,
} from './drafts';

/** Keep as they type: the write waits this long after the last keystroke. */
export const DEBOUNCE_MS = 300;

/** The smallest slice of a form control the keeper touches (an HTMLInputElement / HTMLTextAreaElement satisfies it). */
export interface ControlLike { name: string; type: string; value: string; checked?: boolean }
export interface FormLike { elements: ArrayLike<ControlLike> | Iterable<ControlLike> }

const controls = (f: FormLike): ControlLike[] => Array.from(f.elements as ArrayLike<ControlLike>).filter((c) => !!c && typeof c.name === 'string' && c.type !== 'hidden');

/** Read the person's words of one kind from the form (hidden fields never). Unsafe → null. */
export function readForm(form: FormLike, kind: DraftKind): DraftFields | null {
  const cs = controls(form);
  const body = cs.find((c) => c.name === 'body')?.value ?? '';
  if (kind === 'message') return safeFields('message', { body });
  const stars = cs.find((c) => c.name === 'stars' && c.checked)?.value ?? null;
  const subRatings: Record<string, unknown> = {};
  for (const c of cs) if (c.name.startsWith('dim.') && c.checked && c.value !== '') subRatings[c.name.slice(4)] = c.value;
  return safeFields('review', { body, stars, subRatings });
}

/** Write a kept draft back into the form: the words, the overall stars, each dimension (a dimension not kept → "not rated"). */
export function fillForm(form: FormLike, fields: DraftFields): void {
  for (const c of controls(form)) {
    if (c.name === 'body') { c.value = fields.body; continue; }
    if (!('stars' in fields)) continue;
    const r = fields as ReviewDraftFields;
    if (c.name === 'stars' && c.type === 'radio') c.checked = r.stars !== null && c.value === String(r.stars);
    else if (c.name.startsWith('dim.') && c.type === 'radio') {
      const v = r.subRatings[c.name.slice(4)];
      c.checked = v === undefined ? c.value === '' : c.value === String(v);
    }
  }
}

export type KeeperStart =
  | { state: 'off' }                                    // no owner marker on this device (or the store cannot be opened): nothing kept, nothing shown
  | { state: 'done' }                                   // this render IS the act's success: the draft goes (DraftDone), nothing is filled
  | { state: 'empty'; wantedMissing: boolean }          // nothing kept for this ref (a `?draft=` that is no longer on the phone is said)
  | { state: 'restored'; draft: Draft; ask: boolean };  // filled from the phone; `ask` = it is 7 days old or more

export interface KeeperDeps {
  store: DraftStore | null;
  host: string;
  slug: string;
  owner: string | null;
  kind: DraftKind;
  ref: string;
  edit: boolean;
  now: () => number;
  newId: () => string;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  /** told after every write that changed the phone (the header's chip recounts) */
  onWrite?: () => void;
}

export interface Keeper {
  start(o: { wanted: string | null; done: boolean }): Promise<KeeperStart>;
  /** call on every `input` / `change` of the form: the write happens DEBOUNCE_MS after the last one */
  onInput(): void;
  /** write now (the debounce's end; also a page hide) */
  save(): Promise<'saved' | 'removed' | 'refused' | 'off' | 'failed' | 'unchanged'>;
  readonly draftId: string | null;
}

export function createKeeper(form: FormLike, d: KeeperDeps): Keeper {
  let draftId: string | null = null;
  let timer: unknown = null;
  let off = !d.store || !d.owner;
  let last = '';
  const k: Keeper = {
    get draftId() { return draftId; },
    async start({ wanted, done }) {
      if (off || !d.store || !d.owner) { off = true; return { state: 'off' }; }
      const sw = await runSweep(d.store, d.host, d.owner, d.now());       // another owner's drafts go unseen; expired ones go
      if (done) return { state: 'done' };
      const mine = sw.kept.find((x) => x.owner === d.owner && x.slug === d.slug && x.kind === d.kind && x.ref === d.ref);
      if (!mine) return { state: 'empty', wantedMissing: !!wanted };
      draftId = mine.id;
      fillForm(form, mine.fields);
      last = JSON.stringify(mine.fields);
      return { state: 'restored', draft: mine, ask: draftState(mine.savedAt, d.now()) === 'ask' };
    },
    onInput() {
      if (off) return;
      if (timer !== null) d.clearTimer(timer);
      timer = d.setTimer(() => { timer = null; void k.save(); }, DEBOUNCE_MS);
    },
    async save() {
      if (off || !d.store || !d.owner) return 'off';
      const fields = readForm(form, d.kind);
      if (fields === null) return 'refused';                                // a token-shaped or over-long value: nothing written
      const key = JSON.stringify(fields);
      if (key === last) return 'unchanged';
      if (isEmptyFields(fields)) {                                          // the person cleared it: a draft of nothing is not kept
        if (draftId) { const r = await d.store.remove(draftId); if (!r.ok) return 'failed'; }
        draftId = null; last = key; d.onWrite?.(); return 'removed';
      }
      const id = draftId ?? d.newId();
      const draft: Draft = { id, kind: d.kind, host: d.host, slug: d.slug, owner: d.owner, ref: d.ref, fields, savedAt: d.now(), ...(d.edit ? { edit: true } : {}) };
      const r = await d.store.put(draft);
      if (!r.ok) return 'failed';
      draftId = id; last = key; d.onWrite?.();
      return 'saved';
    },
  };
  return k;
}
