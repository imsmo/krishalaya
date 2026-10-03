// apps/web-storefront/src/components/PoweredByMark.tsx · PC-56 TENANT-13d — the small, honest "Powered by Krishalaya" mark.
// Rendered on every member-facing surface unless the tenant chose to hide it AND its plan includes `white_label_unbranded` right now; on
// TRUST surfaces (escrow / pay, orders, disputes, KYC, ledger receipts) it is rendered unconditionally — `poweredByVisible` /
// packages/tokens `showsPoweredBy` decide, from one constant list. The words are the platform's mark (PLATFORM_BRAND), not copy.
export function PoweredByMark({ label }: { label: string }) {
  return <p className="kv-powered-by" data-kv-mark="platform"><small>{label}</small></p>;
}
