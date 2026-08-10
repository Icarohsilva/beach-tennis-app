// middleware.ts
// No Supabase import here — Edge Runtime has no __dirname.
// Cookie check is enough for route guarding; real auth validation
// happens in Server Component layouts (Node.js runtime) via createAdminClient.
import { NextResponse, type NextRequest } from 'next/server'
import { hasSessionCookie } from '@/lib/auth/sessionCookies'

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  // Retorno de checkout do MercadoPago. O validador do MP recusa back_url com
  // path no TLD .website, então TODO checkout usa back_url na RAIZ; ao voltar,
  // o MP anexa ?preapproval_id=... (assinaturas) ou ?external_reference=...
  // (Checkout Pro). /retorno-pagamento identifica o dono e redireciona.
  if (
    pathname === '/' &&
    (searchParams.has('preapproval_id') || searchParams.has('external_reference'))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/retorno-pagamento'
    return NextResponse.redirect(url)
  }

  // Public routes — pass through immediately
  if (
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/cadastro') ||
    pathname.startsWith('/criar-academia') ||
    pathname.startsWith('/recuperar-senha') ||
    pathname.startsWith('/nova-senha') ||
    pathname.startsWith('/experimental') ||
    pathname.startsWith('/arenas') ||
    pathname.startsWith('/ajuda') ||
    pathname.startsWith('/instalar') ||
    pathname.startsWith('/legal') ||
    pathname.startsWith('/t/') ||
    // Capa pública do evento de torneio — é o link que a academia divulga.
    pathname.startsWith('/e/')
  ) {
    return NextResponse.next()
  }

  // Protected routes: require a Supabase session cookie.
  // Regra de nomes (fragmentação e code-verifier) em lib/auth/sessionCookies.ts.
  if (!hasSessionCookie(request.cookies.getAll().map((c) => c.name))) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Admin role check is handled by app/(admin)/layout.tsx (Server Component).
  // Propaga o pathname para o layout admin via header — o gate de cobrança precisa
  // saber a rota atual para isentar a própria /admin/assinatura (senão loop de redirect).
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  // Exclui /api: rotas de API (crons, webhooks) têm autenticação própria
  // (CRON_SECRET / assinatura) e não devem ser redirecionadas para /login.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sitemap.xml|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json|txt|xml|ico|webmanifest)$).*)'],
}
