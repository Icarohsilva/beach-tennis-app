'use server'
// features/dayuse/pageActions.ts
// Página de day use (dayuse_pages): criar, editar a capa e o texto, publicar e
// vincular datas. Mesmo desenho de features/torneios/eventActions.ts — a página
// é só a capa e o agrupamento; reserva e pagamento continuam na data.
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/features/aulas/authGuards'
import { generateUniqueSlugIn } from '@/lib/org/identifiers'
import { brtToday } from '@/lib/utils/gridSchedule'

const COVER_URL = /\/storage\/v1\/object\/public\/dayuse-images\//
const MAX_NAME = 80
const MAX_DESCRIPTION = 2000

function revalidatePage(slug?: string | null) {
  revalidatePath('/admin/grade/dayuse')
  if (slug) revalidatePath(`/dayuse/${slug}`)
  // Desvincular tira a data da página ANTIGA, cujo slug a action nem sempre
  // tem em mãos: revalida a rota inteira em vez de deixar uma capa desatualizada.
  revalidatePath('/dayuse/[slug]', 'page')
}

export async function createDayUsePage(input: {
  name: string
  description?: string | null
}): Promise<{ error?: string; id?: string; slug?: string }> {
  const { orgId, userId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const name = input.name.trim().slice(0, MAX_NAME)
  if (!name) return { error: 'Dê um nome à página. Ex: Day Use de Verão.' }

  const admin = createAdminClient()
  const slug = await generateUniqueSlugIn(admin, 'dayuse_pages', name, 'dayuse')
  const { data, error } = await admin
    .from('dayuse_pages')
    .insert({
      organization_id: orgId,
      name,
      slug,
      description: input.description?.trim().slice(0, MAX_DESCRIPTION) || null,
      // Nasce rascunho: a arena vincula as datas e sobe o flyer antes de
      // divulgar. Publicar de cara exporia uma página vazia.
      is_published: false,
      created_by: userId,
    })
    .select('id, slug')
    .single()
  if (error || !data) return { error: 'Erro ao criar a página. Tente novamente.' }

  revalidatePage()
  return { id: data.id as string, slug: data.slug as string }
}

export async function updateDayUsePageContent(
  pageId: string,
  input: { name: string; description: string | null },
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const name = input.name.trim().slice(0, MAX_NAME)
  if (!name) return { error: 'O nome não pode ficar vazio.' }

  const { data, error } = await createAdminClient()
    .from('dayuse_pages')
    .update({ name, description: input.description?.trim().slice(0, MAX_DESCRIPTION) || null })
    .eq('id', pageId)
    .eq('organization_id', orgId)
    .select('slug')
    .maybeSingle()
  if (error || !data) return { error: 'Erro ao salvar a página.' }

  revalidatePage(data.slug as string)
  return {}
}

/** Capa (flyer). Só aceita URL do bucket público dayuse-images. */
export async function updateDayUsePageCover(
  pageId: string,
  url: string | null,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }
  if (url && !COVER_URL.test(url)) return { error: 'Imagem inválida.' }

  const { data, error } = await createAdminClient()
    .from('dayuse_pages')
    .update({ cover_image_url: url })
    .eq('id', pageId)
    .eq('organization_id', orgId)
    .select('slug')
    .maybeSingle()
  if (error || !data) return { error: 'Erro ao salvar a capa.' }

  revalidatePage(data.slug as string)
  return {}
}

/** Publica ou volta a rascunho. É o interruptor do link divulgado. */
export async function setDayUsePagePublished(
  pageId: string,
  published: boolean,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const admin = createAdminClient()
  if (published) {
    // Publicar sem data futura entrega ao público uma página sem nada para
    // reservar — e o link já estará no grupo quando alguém perceber.
    const { count } = await admin
      .from('dayuse_slots')
      .select('id', { count: 'exact', head: true })
      .eq('page_id', pageId)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .gte('date', brtToday(new Date()))
    if ((count ?? 0) === 0) {
      return { error: 'Vincule ao menos uma data futura antes de publicar a página.' }
    }
  }

  const { data, error } = await admin
    .from('dayuse_pages')
    .update({ is_published: published })
    .eq('id', pageId)
    .eq('organization_id', orgId)
    .select('slug')
    .maybeSingle()
  if (error || !data) return { error: 'Erro ao atualizar a página.' }

  revalidatePage(data.slug as string)
  return {}
}

/** Confere que a página é desta academia. null = "sem página", sempre válido. */
async function pageOfOrg(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  pageId: string | null,
): Promise<{ ok: boolean; slug: string | null }> {
  if (!pageId) return { ok: true, slug: null }
  const { data } = await admin
    .from('dayuse_pages')
    .select('slug')
    .eq('id', pageId)
    .eq('organization_id', orgId)
    .maybeSingle()
  return { ok: Boolean(data), slug: (data?.slug as string | undefined) ?? null }
}

/** Coloca (ou tira, com null) UMA data numa página. */
export async function setDayUseSlotPage(
  slotId: string,
  pageId: string | null,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const admin = createAdminClient()
  // Página de outra academia não entra: sem esta checagem um id alheio poria
  // a data desta arena na capa de outra.
  const page = await pageOfOrg(admin, orgId, pageId)
  if (!page.ok) return { error: 'Página não encontrada nesta academia.' }

  const { error } = await admin
    .from('dayuse_slots')
    .update({ page_id: pageId })
    .eq('id', slotId)
    .eq('organization_id', orgId)
  if (error) return { error: 'Erro ao vincular a data.' }

  revalidatePage(page.slug)
  revalidatePath(`/admin/grade/dayuse/${slotId}`)
  return {}
}

/**
 * Coloca (ou tira) uma RECORRÊNCIA numa página. Leva junto as datas futuras
 * que ela já gerou — senão só as datas geradas daqui para a frente entrariam, e
 * as próximas quatro semanas, que são as que a arena vai divulgar agora,
 * ficariam fora da página.
 */
export async function setDayUseRecurrencePage(
  recurrenceId: string,
  pageId: string | null,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const admin = createAdminClient()
  const page = await pageOfOrg(admin, orgId, pageId)
  if (!page.ok) return { error: 'Página não encontrada nesta academia.' }

  const { error } = await admin
    .from('dayuse_recurrences')
    .update({ page_id: pageId })
    .eq('id', recurrenceId)
    .eq('organization_id', orgId)
  if (error) return { error: 'Erro ao vincular a recorrência.' }

  await admin
    .from('dayuse_slots')
    .update({ page_id: pageId })
    .eq('recurrence_id', recurrenceId)
    .eq('organization_id', orgId)
    .gte('date', brtToday(new Date()))

  revalidatePage(page.slug)
  return {}
}
