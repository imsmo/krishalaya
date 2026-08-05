// apps/web-gov/src/app/api/session/route.ts · session route handler. POST with _action=logout clears the
// httpOnly cookies and redirects to /login. (Login itself is handled by Server Actions on /login.)
import { NextRequest, NextResponse } from 'next/server';
import { clearSession } from '../../../lib/auth';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  if (form.get('_action') === 'logout') clearSession();
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
