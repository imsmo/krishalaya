// apps/web-storefront/src/components/PoweredByMark.tsx · PC-56 TENANT-13d — the small, honest "Powered by Krishalaya" mark.
// Rendered on every member-facing surface unless the tenant chose to hide it AND its plan includes `white_label_unbranded` right now; on
// TRUST surfaces (escrow / pay, orders, disputes, KYC, ledger receipts) it is rendered unconditionally — `poweredByVisible` /
// packages/tokens `showsPoweredBy` decide, from one constant list. The words are the platform's mark (PLATFORM_BRAND), not copy.
// PC-56 STORE-SWEEP-a · D4 (founder Q5): with an `href` the mark is a LINK to the platform's About page (`/about` on the same origin for a path
// store; the platform's origin on a store's own host — features/sweep/paths.ts `platformAboutHref`): a white-label store's one honest way to the
// platform's own pages. Without one it stays the plain mark (the offline shell's header has its own).
export function PoweredByMark({ label, href }: { label: string; href?: string }) {
  return (
    <p className="kv-powered-by" data-kv-mark="platform">
      {href ? <a href={href} className="kv-powered-by__link" data-kv-link="platform-about"><small>{label}</small></a> : <small>{label}</small>}
    </p>
  );
}
