// middleware.ts
// No Supabase import here — Edge Runtime has no __dirname.
// Cookie check is enough for route guarding; real auth validation
// happens in Server Component layouts (Node.js runtime) via createAdminClient.
import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes — pass through immediately
  if (
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/cadastro') ||
    pathname.startsWith('/recuperar-senha') ||
    pathname.startsWith('/experimental')
  ) {
    return NextResponse.next()
  }

  // Protected routes: require a Supabase session cookie.
  // Supabase SSR sets cookies named sb-<project-ref>-auth-token.
  const hasSession = request.cookies.getAll().some(
    (c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'),
  )

  if (!hasSession) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Admin role check is handled by app/(admin)/layout.tsx (Server Component).
  return NextResponse.next()
}

export const config = {
  // Exclui /api: rotas de API (crons, webhooks) têm autenticação própria
  // (CRON_SECRET / assinatura) e não devem ser redirecionadas para /login.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
