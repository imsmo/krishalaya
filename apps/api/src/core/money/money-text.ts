// core/money/money-text.ts · PC-56 TENANT-6d-7 · MONEY A HUMAN CAN READ, in the one place that decides how.
//
// TENANT-4d-5 wrote this function and its argument inside the tenancy module, for the SaaS billing notices. This wave
// needed the same thing for six dairy member notices — *"{{net}}"*, *"{{gross}}"*, *"{{deductions}}"*,
// *"{{how_much}}"* — and there were exactly two options: import another module's domain file, or write the rule a
// second time. This programme has now found the same defect four times (a rule written twice drifts, and the copy that
// drifts is the one no test covers), so the rule moved HERE and tenancy delegates to it. One implementation, one spec,
// two callers, no drift.
//
// THE ARGUMENT, KEPT VERBATIM FROM 4d-5 BECAUSE IT IS STILL THE ARGUMENT:
//
//   `NotificationTemplate.render()` interpolates whatever the payload holds and every billing payload on this platform
//   carries amounts as a string of MINOR UNITS. A template body reading "You owe {{totalMinor}}" would send an FPO
//   "You owe 795400". The one seeded precedent hedges — `dispute.refunded` sends "A refund of {{amountMinor}} (minor
//   units) was issued" — which is honest, unreadable, and not good enough for a document somebody pays against.
//
//   So the emitter formats, and it formats EXACTLY:
//     • integer arithmetic on the minor amount against that currency's own `minor_units` (INR 2, JPY 0, KWD 3), never
//       a float and never a hardcoded ÷100 — a hardcoded 100 is the shape that blocks a country;
//     • the ISO 4217 CODE rather than a symbol, because the same body is rendered for recipients in three languages
//       off one payload and "₹" is not the right glyph in every script the platform ships, while "INR" is unambiguous
//       in all of them and needs no locale data the platform does not have;
//     • grouping every three digits from the right, which is wrong for the Indian lakh/crore convention and is
//       therefore NOT claimed to be localised — it is a plain, stable, machine-checkable rendering.
//
// WHAT TENANT-6d-7 CHANGES ABOUT THAT LAST POINT: 4d-5 named per-locale grouping as a follow-up *"because a locale per
// RECIPIENT is needed and the payload is shared across recipients"*. The payload can now carry a per-language map
// (`core/i18n/lang-map.ts`) and the renderer picks by the template's language — so the mechanism exists. The GROUPING
// itself still does not, because lakh/crore formatting is a real locale table this platform does not hold, and
// approximating it with a regex per language would be a guess printed next to somebody's money. Named, not faked.
export function moneyText(minor: bigint, currencyCode: string, minorUnits: number): string {
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 4) {
    throw new Error(`moneyText: minor_units out of range for ${currencyCode}`);
  }
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const scale = 10n ** BigInt(minorUnits);
  const whole = (abs / scale).toString();
  const frac = minorUnits === 0 ? '' : `.${(abs % scale).toString().padStart(minorUnits, '0')}`;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currencyCode.toUpperCase()} ${neg ? '-' : ''}${grouped}${frac}`;
}
