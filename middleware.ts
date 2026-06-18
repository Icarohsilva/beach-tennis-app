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
    pathname.startsWith('/criar-academia') ||
    pathname.startsWith('/recuperar-senha') ||
    pathname.startsWith('/nova-senha') ||
    pathname.startsWith('/experimental') ||
    pathname.startsWith('/arenas')
  ) {
    return NextResponse.next()
  }

  // Protected routes: require a Supabase session cookie.
  // Supabase SSR sets cookies named sb-<project-ref>-auth-token. Sessões grandes
  // (ex.: muito user_metadata) são FRAGMENTADAS em sb-<ref>-auth-token.0, .1, ...
  // que NÃO terminam em "-auth-token". Por isso usamos includes() e não endsWith():
  // senão usuários com cookie fragmentado caem em loop de redirect para /login.
  const hasSession = request.cookies.getAll().some(
    (c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'),
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
