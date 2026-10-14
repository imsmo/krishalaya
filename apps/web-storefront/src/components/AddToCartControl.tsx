'use client';
// apps/web-storefront/src/components/AddToCartControl.tsx · PC-56 STORE-2b · C3 — the add-to-cart quantity and its button. The button says what it
// will do — "Add N <unit> to cart" — with N the quantity as typed (the label template is translated on the server with a literal `{qty}` the
// field fills in; an entry that is not a number shows the plain "Add to cart"). NO line total is computed here (the canon's live total is a
// recorded DELTA: the cart prints the server's). Without JS the form still posts and the label shows the server-rendered quantity.
import { useState } from 'react';

const QTY = /^\d{1,7}(?:\.\d{1,3})?$/;

export function AddToCartControl({ id, label, defaultQty, template, plain, describedBy }: {
  id: string; label: string; defaultQty: string; template: string; plain: string; describedBy?: string;
}) {
  const [qty, setQty] = useState(defaultQty);
  const text = QTY.test(qty.trim()) && Number(qty) > 0 ? template.replace('{qty}', qty.trim()) : plain;
  return (
    <>
      <label htmlFor={id} className="kv-field__label">{label}</label>
      <input id={id} name="quantity" type="text" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)}
        className="kv-field__input kv-actions__qty" aria-describedby={describedBy} />
      <button type="submit" className="kv-btn" data-kv-add="cart">{text}</button>
    </>
  );
}
