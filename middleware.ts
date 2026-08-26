// middleware.ts
// No Supabase import here — Edge Runtime has no __dirname.
// Cookie check is enough for route guarding; real auth validation
// happens in Server Component layouts (Node.js runtime) via createAdminClient.
import { NextResponse, type NextRequest } from 'next/server'
import { hasSessionCookie, isSessionCookieName } from '@/lib/auth/sessionCookies'
import { SESSION_EPOCH, SESSION_EPOCH_COOKIE, precisaReautenticar } from '@/lib/version'

const UM_ANO = 60 * 60 * 24 * 365

function marcarEpoch(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_EPOCH_COOKIE, String(SESSION_EPOCH), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: UM_ANO,
  })
  return response
}

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  // ── Época da sessão ──────────────────────────────────────────────────────
  // Interruptor manual de "todo mundo entra de novo": bumpar SESSION_EPOCH em
  // lib/version.ts derruba as sessões no próximo request. Fica no middleware, e não
  // no cliente, porque assim vale também para quem está rodando um bundle antigo.
  //
  // Roda ANTES do desvio de rota pública: quem está logado numa tela aberta (a raiz,
  // /instalar) também precisa cair. Mas só redireciona quem TEM sessão — visitante
  // não é expulso de tela pública — e nunca a partir do próprio /login, que seria
  // laço.
  const cookieNames = request.cookies.getAll().map((c) => c.name)
  const epochDoCookie = request.cookies.get(SESSION_EPOCH_COOKIE)?.value
  const epochDesatualizado = epochDoCookie !== String(SESSION_EPOCH)

  if (
    precisaReautenticar(epochDoCookie, SESSION_EPOCH) &&
    hasSessionCookie(cookieNames) &&
    !pathname.startsWith('/login')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    const response = NextResponse.redirect(url)
    // isSessionCookieName, e não uma regra reescrita aqui: ela já sabe que a sessão
    // vem fragmentada em `.0`, `.1`, … e que o `-code-verifier` do fluxo "esqueci
    // minha senha" NÃO é sessão. Duplicar essa regra é onde o bug nasceria.
    for (const name of cookieNames) {
      if (isSessionCookieName(name)) response.cookies.delete(name)
    }
    // A época nova vai na MESMA resposta: sem isso o próximo request repete o
    // redirect e vira laço.
    return marcarEpoch(response)
  }

  // Quem já está em dia não recebe Set-Cookie a cada request.
  const finalizar = epochDesatualizado
    ? marcarEpoch
    : (response: NextResponse) => response

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
    return finalizar(NextResponse.redirect(url))
  }

  // Bancada de responsividade (app/dev/): ferramenta de desenvolvimento, sem
  // sessão. A dupla trava é de propósito — em produção este desvio não existe E a
  // própria página responde notFound(), então nenhuma das duas metades sozinha
  // expõe a rota.
  if (process.env.NODE_ENV !== 'production' && pathname.startsWith('/dev/')) {
    return finalizar(NextResponse.next())
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
    pathname.startsWith('/e/') ||
    // Link pessoal de pagamento de inscrição de torneio (quem paga pode ser
    // o parceiro convidado, sem sessão nesta aba).
    pathname.startsWith('/p/')
  ) {
    return finalizar(NextResponse.next())
  }

  // Protected routes: require a Supabase session cookie.
  // Regra de nomes (fragmentação e code-verifier) em lib/auth/sessionCookies.ts.
  if (!hasSessionCookie(cookieNames)) {
    return finalizar(NextResponse.redirect(new URL('/login', request.url)))
  }

  // Admin role check is handled by app/(admin)/layout.tsx (Server Component).
  // Propaga o pathname para o layout admin via header — o gate de cobrança precisa
  // saber a rota atual para isentar a própria /admin/assinatura (senão loop de redirect).
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)
  return finalizar(NextResponse.next({ request: { headers: requestHeaders } }))
}

export const config = {
  // Exclui /api: rotas de API (crons, webhooks) têm autenticação própria
  // (CRON_SECRET / assinatura) e não devem ser redirecionadas para /login.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sitemap.xml|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json|txt|xml|ico|webmanifest)$).*)'],
}
