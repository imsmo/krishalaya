// apps/web-ops/src/components/Sidebar.tsx · the ops-console nav (PC-30 OW-0). Links ONLY to built routes
// (the law): OW-0 ships the dashboard; each OW wave adds its entry as it lands. No client JS.
import { getTranslator, getLang } from '../lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';

const NAV: ReadonlyArray<{ href: string; labelKey: string; sub?: boolean; group?: string }> = [
  { href: '/dashboard', labelKey: 'nav.dashboard' },
  { href: '/kiosk/home', labelKey: 'nav.kiosk' }, // OW-1 → PC-56 OPS-1c · W380 (`/kiosk` answers a 307 here)
  { href: '/kiosk/session-start', labelKey: 'nav.kioskStart', sub: true }, // PC-56 OPS-1c · W381 (the one form: an account for a new number)
  { href: '/kiosk/ambassador', labelKey: 'nav.kioskEarnings', sub: true }, // PC-56 OPS-1c · W389 (her own earnings)
  // PC-56 OPS-2a (survey E2): the warehouse section in the canon's three groups — Intake · Receipts · Money & insight — with Stacking added under
  // Intake (W374 was an orphan) and the assay record (W373) reached from the assay page. `/warehouse` answers a 307 to the dashboard.
  { href: '/warehouse/dashboard', labelKey: 'nav.warehouse', group: 'nav.whGroupIntake' }, // OW-2 → PC-56 OPS-2a · W370
  { href: '/warehouse/weighbridge', labelKey: 'nav.whWeighbridge', sub: true }, // PC-56 OPS-2a · W371 (honest; reads nothing)
  { href: '/warehouse/assay', labelKey: 'nav.whAssay', sub: true }, // PC-56 OPS-2b · W372 (one booking's assays; W373 is reached from it)
  { href: '/warehouse/stacking', labelKey: 'nav.whStacking', sub: true }, // PC-56 OPS-2a · W374 (honest; reads nothing)
  { href: '/warehouse/enwr/issue', labelKey: 'nav.whEnwrIssue', sub: true, group: 'nav.whGroupReceipts' }, // PC-56 OPS-2b · W375 (honest; this platform issues none)
  { href: '/warehouse/enwr/registry', labelKey: 'nav.whEnwrRegistry', sub: true }, // PC-56 OPS-2b · W376 (the receipt records; read only)
  { href: '/warehouse/withdrawal', labelKey: 'nav.withdrawal', sub: true }, // PC-56 OPS-1a · W377 (the warehouse section)
  { href: '/warehouse/billing', labelKey: 'nav.whBilling', sub: true, group: 'nav.whGroupMoney' }, // PC-56 OPS-2c · W378 (the rate on file; nothing is billed)
  { href: '/warehouse/insights', labelKey: 'nav.whInsights', sub: true }, // PC-56 OPS-2c · W379 (honest; reads nothing)
  { href: '/equipment', labelKey: 'nav.equipment' }, // OW-3
  // PC-56 OPS-3c (survey E2): a Dairy group of BUILT routes only. OPS-3a adds the counter's four pages a person opens (`/pos/quality` and
  // `/pos/slip` are steps of the record act, reached from them); OPS-3b adds the cooler (`/bmc`).
  { href: '/dairy', labelKey: 'nav.dairy', group: 'nav.dairyGroup' }, // OW-4
  { href: '/payout', labelKey: 'nav.payout', sub: true }, // PC-56 OPS-1a · W367 (the dairy section)
  { href: '/rates', labelKey: 'nav.rates', sub: true }, // PC-56 OPS-3c · W368 (the approved milk rate cards; read only)
  { href: '/pos/home', labelKey: 'nav.posHome', sub: true }, // PC-56 OPS-3a · W360 (the centre in your custody; read)
  { href: '/pos/collect', labelKey: 'nav.posCollect', sub: true }, // PC-56 OPS-3a · W361 → W362 (the record act)
  { href: '/pos/shift-close', labelKey: 'nav.posShift', sub: true }, // PC-56 OPS-3a · W365 (the shift's totals; read)
  { href: '/pos/exceptions', labelKey: 'nav.posExceptions', sub: true }, // PC-56 OPS-3a · W364 (honest; reads nothing)
  { href: '/bmc', labelKey: 'nav.bmc', sub: true }, // PC-56 OPS-3b · W366 (the cooler at your centre; read + the manual reading)
  { href: '/aeps/home', labelKey: 'nav.aeps' }, // PC-56 OPS-1b · W390 (OW-5's `/money` answers a 307 to /aeps/withdrawal)
  { href: '/aeps/withdrawal', labelKey: 'nav.aepsRecord', sub: true }, // PC-56 OPS-1b · W391
  { href: '/aeps/exceptions', labelKey: 'nav.aepsExceptions', sub: true }, // PC-56 OPS-1b · W392
  { href: '/attendance/face-enroll', labelKey: 'nav.attendance' }, // PC-56 OPS-1b · W397 (W398 linked from it)
  { href: '/canon/biometric', labelKey: 'nav.biometric', sub: true }, // PC-56 OPS-1b · W399 (a platform page — never under Dairy)
  { href: '/insights', labelKey: 'nav.insights' }, // OW-6
  { href: '/devices', labelKey: 'nav.devices' }, // OW-7 (PC-55 B4)
  // OW-1 kiosk · OW-2 warehouse · OW-3 equipment/CHC · OW-4 dairy POS · OW-5 assisted money · OW-6 insights
  // are appended here by their waves (OPS_BUILD_BACKLOG.md) — never linked before they exist.
];

export function Sidebar() {
  const t = getTranslator();
  const lang = getLang();
  return (
    <nav className="kv-sidebar" aria-label={t.t('nav.primary')}>
      <a href="/dashboard" className="kv-brand">{t.t('nav.brand')}</a>
      <ul className="kv-sidebar__nav">
        {NAV.flatMap((n) => [
          // PC-56 OPS-2a: a group heading (text, not a link) before the first entry of a group.
          ...(n.group ? [<li key={`g-${n.group}`} className="kv-sidebar__group" data-kv-nav-group={n.group}>{t.t(n.group)}</li>] : []),
          <li key={n.href}><a href={n.href} className={n.sub ? 'kv-sidebar__link kv-sidebar__link--sub' : 'kv-sidebar__link'}>{t.t(n.labelKey)}</a></li>,
        ])}
      </ul>
      <div className="kv-sidebar__footer">
        <LocaleSwitcher active={lang} label={t.t('lang.label')} />
        <form action="/api/session" method="post">
          <input type="hidden" name="_action" value="logout" />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('nav.signOut')}</button>
        </form>
      </div>
    </nav>
  );
}
