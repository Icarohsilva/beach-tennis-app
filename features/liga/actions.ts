'use server'
// features/liga/actions.ts
// Ações do próprio aluno na Liga.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { MEDAL_BY_KEY } from '@/lib/liga/medals'
import { sportLabel } from '@/lib/arenas/sports'

/**
 * Marca as medalhas como vistas, encerrando a comemoração.
 *
 * O filtro por `student_id` do usuário da sessão não é redundante com o id da medalha:
 * o id vem do cliente, e sem esse filtro qualquer pessoa poderia apagar a comemoração
 * de outro aluno passando ids alheios. Mesma classe de IDOR que
 * `features/organizations/actions.ts` já documenta.
 */
export async function markLigaMedalsSeen(medalIds: string[]): Promise<{ error?: string }> {
  if (medalIds.length === 0) return {}

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Academia não encontrada.' }

  const { error } = await createAdminClient()
    .from('liga_medals')
    .update({ seen_at: new Date().toISOString() })
    .in('id', medalIds.slice(0, 50))
    .eq('student_id', user.id)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao registrar as medalhas.' }

  revalidatePath('/liga')
  return {}
}

/**
 * Publica as medalhas recém-conquistadas no feed da academia.
 *
 * É o momento em que a conquista individual vira conteúdo social sem o aluno precisar
 * escrever nada — e o motivo de a comemoração existir na tela em vez de a medalha só
 * aparecer na vitrine.
 */
export async function shareLigaMedals(medalIds: string[]): Promise<{ error?: string }> {
  if (medalIds.length === 0) return {}

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Academia não encontrada.' }

  const admin = createAdminClient()

  // student_id do usuário da sessão: o id da medalha vem do cliente, e sem este
  // filtro daria para publicar a conquista de outra pessoa.
  const { data: rows } = await admin
    .from('liga_medals')
    .select('medal_key, sport')
    .in('id', medalIds.slice(0, 10))
    .eq('student_id', user.id)
    .eq('organization_id', orgId)

  const medals = (rows ?? []) as { medal_key: string; sport: string | null }[]
  if (medals.length === 0) return { error: 'Medalha não encontrada.' }

  const linhas = medals
    .map((m) => {
      const def = MEDAL_BY_KEY.get(m.medal_key)
      if (!def) return null
      const modalidade = m.sport ? ` (${sportLabel(m.sport)})` : ''
      return `🏅 ${def.label}${modalidade} — ${def.description}`
    })
    .filter((l): l is string => l !== null)

  if (linhas.length === 0) return { error: 'Medalha não encontrada.' }

  const content =
    linhas.length === 1
      ? `Conquistei uma medalha na Liga!\n\n${linhas[0]}`
      : `Conquistei ${linhas.length} medalhas na Liga!\n\n${linhas.join('\n')}`

  const { error } = await admin.from('posts').insert({
    organization_id: orgId,
    author_id: user.id,
    content,
    image_urls: [],
    likes_count: 0,
  })
  if (error) return { error: 'Erro ao publicar no feed.' }

  // Marca como vistas junto: quem compartilhou já viu.
  await admin
    .from('liga_medals')
    .update({ seen_at: new Date().toISOString() })
    .in('id', medalIds.slice(0, 10))
    .eq('student_id', user.id)
    .eq('organization_id', orgId)

  revalidatePath('/liga')
  return {}
}
