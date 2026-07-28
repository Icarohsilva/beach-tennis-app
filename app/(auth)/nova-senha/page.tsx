// app/(auth)/nova-senha/page.tsx
// Server Component: o formulário só aparece se /nova-senha/confirmar tiver acabado de
// validar o token (cookie marcador) E existir sessão. Antes isto era um Client
// Component que confiava no supabase-js para detectar o ?code sozinho — e quando o
// code_verifier não estava naquele navegador ele silenciosamente reaproveitava a
// sessão anterior, mostrando "link expirado" (ou trocando a senha da conta errada).
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RECOVERY_COOKIE } from '@/lib/auth/sessionCookies'
import { NovaSenhaForm } from './NovaSenhaForm'
import { LinkInvalido } from './LinkInvalido'

export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function NovaSenhaPage({ searchParams }: { searchParams: SearchParams }) {
  // Links que chegam com token ainda não trocado vão para a Route Handler, que é quem
  // consegue gravar cookie. Cobre os links antigos (?code=) já na caixa de entrada e um
  // template apontando para /nova-senha em vez de /nova-senha/confirmar.
  const tokenHash = primeiro(searchParams.token_hash)
  const code = primeiro(searchParams.code)
  if (tokenHash || code) {
    const qs = new URLSearchParams(tokenHash ? { token_hash: tokenHash } : { code: code! })
    redirect(`/nova-senha/confirmar?${qs.toString()}`)
  }

  const erro = primeiro(searchParams.erro)
  if (cookies().get(RECOVERY_COOKIE)?.value !== '1') return <LinkInvalido motivo={erro} />

  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return <LinkInvalido motivo="sessao" />

  return <NovaSenhaForm email={user.email ?? ''} />
}
