// app/(auth)/nova-senha/confirmar/route.ts
// Troca o token do e-mail de recuperação por uma sessão. SEMPRE no servidor: só uma
// Route Handler consegue gravar o cookie de sessão, e deixar isso a cargo do cliente
// do navegador era exatamente o bug — sem o code_verifier no storage o supabase-js
// ignora o ?code em silêncio e restaura a sessão ANTERIOR (_isPKCECallback exige code
// + verifier; sem os dois ele cai em _recoverAndRefresh). O usuário então via
// "link expirado" — ou, pior, trocava a senha da conta que já estava logada ali.
//
// Dois formatos de link chegam aqui:
//   token_hash=...&type=recovery → formato atual. verifyOtp não depende de NADA
//     guardado no navegador, então o link funciona em qualquer aparelho.
//   code=...                     → PKCE, formato antigo (links já na caixa de entrada).
//     Exige o cookie code-verifier no MESMO navegador que pediu a recuperação.
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { RECOVERY_COOKIE, RECOVERY_COOKIE_MAX_AGE } from '@/lib/auth/sessionCookies'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const code = searchParams.get('code')

  const falha = (motivo: string) =>
    NextResponse.redirect(new URL(`/nova-senha?erro=${motivo}`, origin))

  const supabase = createClient()

  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      type: 'recovery',
      token_hash: tokenHash,
    })
    // otp_expired cobre os dois casos que o usuário percebe igual: passou da validade
    // OU o token já foi consumido (link antigo (cada pedido novo invalida o anterior),
    // clique duplo, ou scanner de e-mail que abriu a URL antes da pessoa).
    if (error) return falha(error.code === 'otp_expired' ? 'expirado' : 'invalido')
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return falha(
        error.code === 'pkce_code_verifier_not_found' ? 'outro_navegador' : 'expirado',
      )
    }
  } else {
    return falha('sem_token')
  }

  const resposta = NextResponse.redirect(new URL('/nova-senha', origin))
  resposta.cookies.set(RECOVERY_COOKIE, '1', {
    path: '/',
    maxAge: RECOVERY_COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  return resposta
}
