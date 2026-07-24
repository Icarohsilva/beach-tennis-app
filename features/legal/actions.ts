'use server'
// features/legal/actions.ts
// Registro de aceite de documentos legais (Termos, Privacidade, Contrato SaaS, DPA).
import { headers } from 'next/headers'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { LEGAL_DOCUMENTS, type LegalSlug } from '@/lib/legal/documents'

// O cadastro de aluno (app/(auth)/cadastro) chama supabase.auth.signUp() direto do
// client, sem sessão garantida (fluxo de confirmação de e-mail) — uma action que
// confiasse cegamente no userId recebido do client seria forjável (IDOR: qualquer
// um grava aceite em nome de outra conta). Por isso: prioriza a sessão real; só aceita
// o userId sugerido pelo client se NÃO há sessão E a conta foi criada há poucos
// minutos — fecha a janela de abuso sem exigir mudança no fluxo de auth existente.
const RECENT_ACCOUNT_WINDOW_MS = 30 * 60 * 1000

export async function acceptLegalDocuments(
  candidateUserId: string,
  slugs: LegalSlug[],
): Promise<{ error?: string }> {
  const validSlugs = slugs.filter((s) => s in LEGAL_DOCUMENTS)
  if (validSlugs.length === 0) return { error: 'Nenhum documento válido informado.' }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  let userId: string
  if (user) {
    userId = user.id
  } else {
    const { data: prof } = await admin
      .from('profiles')
      .select('id, created_at')
      .eq('id', candidateUserId)
      .maybeSingle()
    if (!prof) return { error: 'Usuário não encontrado.' }
    if (Date.now() - new Date(prof.created_at as string).getTime() > RECENT_ACCOUNT_WINDOW_MS) {
      return { error: 'Não foi possível registrar o aceite. Faça login e tente novamente.' }
    }
    userId = prof.id as string
  }

  const h = headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const userAgent = h.get('user-agent') || null

  const { error } = await admin.from('legal_acceptances').upsert(
    validSlugs.map((slug) => ({
      user_id: userId,
      doc_slug: slug,
      version: LEGAL_DOCUMENTS[slug].version,
      ip_address: ip,
      user_agent: userAgent,
    })),
    { onConflict: 'user_id,doc_slug,version', ignoreDuplicates: true },
  )
  if (error) return { error: 'Erro ao registrar o aceite. Tente novamente.' }
  return {}
}
