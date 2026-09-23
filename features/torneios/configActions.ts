'use server'
// features/torneios/configActions.ts
// Configuração de conteúdo público do torneio — descrição, regulamento,
// local, horário, prazo de inscrição — e premiação. Separado de actions.ts
// (que já passa de 1600 linhas) porque é uma responsabilidade diferente:
// aquele arquivo é o motor (inscrição, chave, placar); este é o que a
// academia ESCREVE sobre o torneio antes dele acontecer.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { presentOrNull } from '@/lib/torneios/content'
import { canonicalizePairGenders } from '@/lib/torneios/pairRules'
import { shirtConfig, validateShirtName, validateShirtSize } from '@/lib/torneios/shirt'
import { LEVEL_ORDER } from '@/lib/torneios/sportProfile'
import type { PairGenders } from '@/types'

async function requireAdmin(): Promise<
  { orgId: string; adminClient: ReturnType<typeof createAdminClient> } | { error: string }
> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const adminClient = createAdminClient()
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  return { orgId, adminClient }
}

function revalidateTournament(tournamentId: string, eventSlug?: string | null) {
  revalidatePath(`/admin/torneios/${tournamentId}`)
  revalidatePath(`/admin/torneios/${tournamentId}/editar`)
  revalidatePath(`/t/${tournamentId}`)
  if (eventSlug) revalidatePath(`/e/${eventSlug}`)
}

// ---------------------------------------------------------------------------
// updateTournamentContent
// ---------------------------------------------------------------------------

export async function updateTournamentContent(
  tournamentId: string,
  input: {
    description?: string | null
    rules?: string | null
    venue?: string | null
    start_time?: string | null
    registration_deadline?: string | null
  },
): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, date, event:tournament_events(slug)')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournament) return { error: 'Torneio não encontrado.' }

  // Prazo não pode passar do próprio dia do torneio — comparação na action
  // (não em CHECK): misturar timestamptz com date+interval puxaria o fuso do
  // GUC e deixaria de ser imutável.
  if (input.registration_deadline) {
    const deadline = new Date(input.registration_deadline)
    const endOfTournamentDay = new Date(`${tournament.date as string}T23:59:59-03:00`)
    if (deadline.getTime() > endOfTournamentDay.getTime()) {
      return { error: 'O prazo de inscrição não pode ser depois do dia do torneio.' }
    }
  }

  const update: Record<string, string | null> = {}
  if ('description' in input) update.description = presentOrNull(input.description)
  if ('rules' in input) update.rules = presentOrNull(input.rules)
  if ('venue' in input) update.venue = presentOrNull(input.venue)
  if ('start_time' in input) update.start_time = presentOrNull(input.start_time)
  if ('registration_deadline' in input) update.registration_deadline = input.registration_deadline ?? null

  const { error } = await adminClient.from('tournaments').update(update).eq('id', tournamentId)
  if (error) return { error: 'Erro ao salvar. Tente novamente.' }

  const eventRaw = tournament.event as { slug: string } | { slug: string }[] | null
  const eventSlug = Array.isArray(eventRaw) ? eventRaw[0]?.slug : eventRaw?.slug
  revalidateTournament(tournamentId, eventSlug)
  return {}
}

// ---------------------------------------------------------------------------
// updateTournamentPairGenders — quem pode entrar/parear por gênero
// ---------------------------------------------------------------------------
// createTournament (features/torneios/actions.ts) já deriva o valor inicial da
// categoria (masculino→MM, feminino→FF, misto→MF, livre→qualquer). Esta action
// existe para o torneio que nasceu ANTES dessa mudança, ou para o caso raro de
// um "Masculino" que precisa aceitar outra formação — é o mesmo conjunto que
// canPairUp()/canEnter() (lib/torneios/pairRules.ts) validam na inscrição.

export async function updateTournamentPairGenders(
  tournamentId: string,
  allowed: PairGenders[],
): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const canon = canonicalizePairGenders(allowed)
  if (canon.length === 0) return { error: 'Selecione ao menos uma formação de dupla.' }

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, event:tournament_events(slug)')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournament) return { error: 'Torneio não encontrado.' }

  // Trocar a regra com gente já inscrita pode deixar uma dupla ou um jogador
  // de fora do que o torneio passa a aceitar — a checagem completa (reler o
  // gênero de cada inscrito e cada parceiro) é trabalho demais para um caso
  // raro; mais simples e sempre seguro é recusar e pedir para revisar as
  // inscrições à mão antes.
  const { count } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
  if ((count ?? 0) > 0) {
    return {
      error:
        'Este torneio já tem inscrição. Mudar a regra de gênero agora poderia deixar alguém já inscrito fora do que passaria a valer — revise as inscrições antes.',
    }
  }

  const { error } = await adminClient
    .from('tournaments')
    .update({ allowed_pair_genders: canon })
    .eq('id', tournamentId)
  if (error) return { error: 'Erro ao salvar. Tente novamente.' }

  const eventRaw = tournament.event as { slug: string } | { slug: string }[] | null
  const eventSlug = Array.isArray(eventRaw) ? eventRaw[0]?.slug : eventRaw?.slug
  revalidateTournament(tournamentId, eventSlug)
  return {}
}

// ---------------------------------------------------------------------------
// Camisa — ligar/desligar depois que o torneio já existe
// ---------------------------------------------------------------------------

/**
 * Liga ou desliga a camisa num torneio JÁ CRIADO.
 *
 * Existe porque a chave só nascia no formulário de criação, e a decisão de dar
 * camisa quase sempre vem depois — quando a arena fecha o patrocínio, com gente
 * já inscrita. Sem isto o recurso só servia para torneio criado do zero.
 *
 * Ao contrário de `updateTournamentPairGenders`, **não** recusa com inscrição
 * existente: ligar camisa não invalida ninguém, só deixa quem já entrou sem
 * tamanho. Quem resolve isso é `setEntryShirt` — a tela lista quem falta.
 */
export async function updateTournamentShirts(
  tournamentId: string,
  input: { sizes: boolean; names: boolean },
): Promise<{ error?: string; missing?: number }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, event:tournament_events(slug)')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournament) return { error: 'Torneio não encontrado.' }

  const { error } = await adminClient
    .from('tournaments')
    .update({
      shirt_sizes_enabled: input.sizes,
      // Nome sem camisa não existe — o mesmo teto que `shirtConfig` aplica na
      // leitura, aplicado também na escrita para o dado não ficar incoerente.
      shirt_names_enabled: input.sizes && input.names,
    })
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
  if (error) return { error: 'Erro ao salvar. Tente novamente.' }

  // Quantos já inscritos ficaram sem tamanho: é o que a tela precisa dizer na
  // hora, senão o admin liga a camisa e só descobre o buraco na planilha.
  const { count } = await adminClient
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('entry_status', 'confirmed')
    .is('shirt_size', null)

  const eventRaw = tournament.event as { slug: string } | { slug: string }[] | null
  const eventSlug = Array.isArray(eventRaw) ? eventRaw[0]?.slug : eventRaw?.slug
  revalidateTournament(tournamentId, eventSlug)
  return { missing: input.sizes ? (count ?? 0) : 0 }
}

/**
 * Preenche (ou corrige) a camisa de UM lado de uma inscrição.
 *
 * Dois donos possíveis, e é a MESMA função: o admin, que digita o que a pessoa
 * respondeu no grupo, e o próprio inscrito, que informa o dele sem depender de
 * ninguém. Separar em duas actions faria a validação divergir — e é a mesma
 * regra (`validateShirtSize`/`validateShirtName`) nos dois casos.
 *
 * Quem não é admin só alcança o PRÓPRIO lado: o `side` é derivado da inscrição,
 * nunca recebido do cliente, senão daria para escrever a camisa do parceiro.
 */
export async function setEntryShirt(
  entryId: string,
  input: { size?: unknown; name?: unknown; side?: 'player' | 'partner' },
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const { data: entryRaw } = await adminClient
    .from('tournament_entries')
    .select('id, organization_id, tournament_id, player_id, partner_id')
    .eq('id', entryId)
    .maybeSingle()
  if (!entryRaw) return { error: 'Inscrição não encontrada.' }
  const entry = entryRaw as {
    organization_id: string
    tournament_id: string
    player_id: string
    partner_id: string | null
  }

  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', entry.organization_id)
    .maybeSingle()
  const isAdmin = membership?.role === 'admin'

  // O lado: do admin vem por parâmetro (ele preenche por qualquer um); do
  // inscrito é DERIVADO de onde ele está na inscrição.
  let side: 'player' | 'partner'
  if (isAdmin && input.side) {
    side = input.side
  } else if (user.id === entry.player_id) {
    side = 'player'
  } else if (user.id === entry.partner_id) {
    side = 'partner'
  } else {
    return { error: 'Você não participa desta inscrição.' }
  }
  if (side === 'partner' && !entry.partner_id) return { error: 'Esta inscrição não tem parceiro.' }

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('shirt_sizes_enabled, shirt_names_enabled')
    .eq('id', entry.tournament_id)
    .maybeSingle()
  const cfg = shirtConfig(tournament ?? {})
  if (!cfg.size) return { error: 'Este torneio não dá camisa.' }

  const size = validateShirtSize(input.size, { required: true })
  if (!size.ok) return { error: size.error }
  const name = validateShirtName(input.name, { required: cfg.name })
  if (!name.ok) return { error: name.error }

  const payload = side === 'partner'
    ? { partner_shirt_size: size.size, partner_shirt_name: name.name }
    : { shirt_size: size.size, shirt_name: name.name }

  const { error } = await adminClient
    .from('tournament_entries')
    .update(payload)
    .eq('id', entryId)
  if (error) return { error: 'Erro ao salvar o tamanho. Tente novamente.' }

  revalidateTournament(entry.tournament_id)
  revalidatePath(`/torneios/${entry.tournament_id}`)
  return {}
}

// ---------------------------------------------------------------------------
// Premiação — tournament_prizes
// ---------------------------------------------------------------------------

export async function upsertTournamentPrize(
  tournamentId: string,
  prize: {
    id?: string
    kind: 'podium' | 'special'
    position?: number | null
    description: string
    value_cents?: number | null
  },
): Promise<{ error?: string; id?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  if (!prize.description.trim()) return { error: 'Descreva o prêmio.' }
  if (prize.kind === 'podium' && !prize.position) return { error: 'Informe a colocação do prêmio.' }

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournament) return { error: 'Torneio não encontrado.' }

  const payload = {
    organization_id: orgId,
    tournament_id: tournamentId,
    kind: prize.kind,
    position: prize.kind === 'podium' ? prize.position : null,
    description: prize.description.trim(),
    value_cents: prize.value_cents ?? null,
  }

  if (prize.id) {
    const { error } = await adminClient
      .from('tournament_prizes')
      .update(payload)
      .eq('id', prize.id)
      .eq('tournament_id', tournamentId)
    if (error) return { error: 'Erro ao salvar prêmio. Tente novamente.' }
    revalidateTournament(tournamentId)
    return { id: prize.id }
  }

  const { data, error } = await adminClient.from('tournament_prizes').insert(payload).select('id').single()
  if (error) {
    // unique parcial (tournament_id, position) — já existe prêmio para essa colocação.
    if (error.code === '23505') return { error: 'Já existe um prêmio para esta colocação.' }
    return { error: 'Erro ao salvar prêmio. Tente novamente.' }
  }
  revalidateTournament(tournamentId)
  return { id: data.id as string }
}

export async function deleteTournamentPrize(prizeId: string): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const { data: prize } = await adminClient
    .from('tournament_prizes')
    .select('tournament_id')
    .eq('id', prizeId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!prize) return { error: 'Prêmio não encontrado.' }

  const { error } = await adminClient.from('tournament_prizes').delete().eq('id', prizeId)
  if (error) return { error: 'Erro ao remover prêmio. Tente novamente.' }

  revalidateTournament(prize.tournament_id as string)
  return {}
}

// ---------------------------------------------------------------------------
// updateTournamentEventContent — descrição/regulamento/local do EVENTO
// ---------------------------------------------------------------------------
// Os torneios do evento herdam daqui quando o campo próprio está vazio (ver
// lib/torneios/content.ts). createTournamentEvent (eventActions.ts) só grava
// na criação; esta é a única forma de corrigir depois.

export async function updateTournamentEventContent(
  eventId: string,
  input: { description?: string | null; rules?: string | null; venue?: string | null },
): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const { data: event } = await adminClient
    .from('tournament_events')
    .select('id, slug')
    .eq('id', eventId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!event) return { error: 'Evento não encontrado.' }

  const update: Record<string, string | null> = {}
  if ('description' in input) update.description = presentOrNull(input.description)
  if ('rules' in input) update.rules = presentOrNull(input.rules)
  if ('venue' in input) update.venue = presentOrNull(input.venue)

  const { error } = await adminClient.from('tournament_events').update(update).eq('id', eventId)
  if (error) return { error: 'Erro ao salvar. Tente novamente.' }

  revalidatePath('/admin/torneios')
  revalidatePath(`/e/${event.slug as string}`)
  return {}
}

/**
 * Capa da página do evento (`/e/[slug]`).
 *
 * A coluna existia desde a criação dos eventos e a página já a desenhava, mas
 * nenhuma tela a preenchia: o evento sempre caía no degradê de fallback, e o
 * link divulgado no WhatsApp saía sem imagem no preview. É a capa que vende o
 * evento — a arte do flyer é o que faz a pessoa abrir.
 *
 * `null` remove. A imagem em si é enviada pelo navegador ao bucket público
 * `tournament-images` (o mesmo da capa do torneio); aqui só se grava a URL.
 */
export async function updateTournamentEventCover(
  eventId: string,
  url: string | null,
): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  // Só URL do nosso storage público. Aceitar qualquer endereço poria na página
  // (e no preview do WhatsApp) uma imagem hospedada sabe-se lá onde.
  if (url !== null && !/\/storage\/v1\/object\/public\/tournament-images\//.test(url)) {
    return { error: 'Imagem inválida. Envie o arquivo pelo botão de capa.' }
  }

  const { data: event } = await adminClient
    .from('tournament_events')
    .select('id, slug')
    .eq('id', eventId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!event) return { error: 'Evento não encontrado.' }

  const { error } = await adminClient
    .from('tournament_events')
    .update({ cover_image_url: url })
    .eq('id', eventId)
  if (error) return { error: 'Erro ao salvar a capa. Tente novamente.' }

  revalidatePath('/admin/torneios')
  revalidatePath(`/e/${event.slug as string}`)
  return {}
}

/**
 * Nível do torneio, depois de criado.
 *
 * O formulário de criação gravava `level: 'iniciante'` fixo, então TODO torneio
 * nascia Iniciante — e a página do evento mostrava o chip "Iniciante" no card
 * do Super Avançado. Esta action conserta os já criados; o formulário passou a
 * perguntar.
 */
export async function updateTournamentLevel(
  tournamentId: string,
  level: string,
): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  if (!(LEVEL_ORDER as readonly string[]).includes(level)) {
    return { error: 'Nível inválido.' }
  }

  const { data: tournament } = await adminClient
    .from('tournaments')
    .select('id, event:tournament_events(slug)')
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!tournament) return { error: 'Torneio não encontrado.' }

  const { error } = await adminClient
    .from('tournaments')
    .update({ level })
    .eq('id', tournamentId)
  if (error) return { error: 'Erro ao salvar. Tente novamente.' }

  const eventRaw = tournament.event as { slug: string } | { slug: string }[] | null
  const eventSlug = Array.isArray(eventRaw) ? eventRaw[0]?.slug : eventRaw?.slug
  revalidateTournament(tournamentId, eventSlug)
  return {}
}

export async function markPrizeDelivered(prizeId: string, delivered: boolean): Promise<{ error?: string }> {
  const ctx = await requireAdmin()
  if ('error' in ctx) return ctx
  const { orgId, adminClient } = ctx

  const { data: prize } = await adminClient
    .from('tournament_prizes')
    .select('tournament_id')
    .eq('id', prizeId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!prize) return { error: 'Prêmio não encontrado.' }

  const { error } = await adminClient
    .from('tournament_prizes')
    .update({ delivered_at: delivered ? new Date().toISOString() : null })
    .eq('id', prizeId)
  if (error) return { error: 'Erro ao atualizar prêmio. Tente novamente.' }

  revalidateTournament(prize.tournament_id as string)
  return {}
}
