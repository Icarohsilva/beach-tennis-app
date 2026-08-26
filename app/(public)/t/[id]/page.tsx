// app/(public)/t/[id]/page.tsx
// A página pública do torneio — a que a academia divulga no Instagram e
// qualquer visitante sem conta consegue ler inteira. Reaproveita os mesmos
// componentes do painel do aluno (TournamentHero, GroupTables, BracketView,
// StandingsTable, PodiumCard, MatchScoreCard em modo `readOnly`,
// PhotoGallery) em vez de um layout paralelo escrito à mão — a versão
// logada já resolve responsividade, tom de marca e o vocabulário certo por
// esporte, então divergir aqui seria manter duas telas para o mesmo dado.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CalendarClock, LayoutGrid, ListOrdered, Swords, Trophy } from 'lucide-react'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils/dateHelpers'
import { getTournamentPhotos } from '@/features/torneios/photoQueries'
import { PhotoGallery } from '@/features/torneios/PhotoGallery'
import { TournamentHero } from '@/features/torneios/TournamentHero'
import { ShareButton } from '@/features/torneios/ShareButton'
import { MatchScoreCard } from '@/features/torneios/MatchScoreCard'
import { GroupTables } from '@/features/torneios/GroupTables'
import { BracketView } from '@/features/torneios/BracketView'
import { StandingsTable } from '@/features/torneios/StandingsTable'
import { PodiumCard, type PodiumPlace } from '@/features/torneios/PodiumCard'
import { PoweredBy } from '@/components/ui/PoweredBy'
import { RegisterExternalButton } from './RegisterExternalButton'
import { ConfirmWaitlistButton } from './ConfirmWaitlistButton'
import { sideOfEntry, chargeFor, type PayableEntry } from '@/lib/torneios/entrySide'
import { ensureEntryPaymentToken } from '@/features/torneios/entryPaymentActions'
import { resolveTournamentContent } from '@/lib/torneios/content'
import { resolveRegistrationWindow, deadlineLabel, closingSoonLabel } from '@/lib/torneios/registrationWindow'
import { sortPrizes, positionLabel, type PrizeRow } from '@/lib/torneios/prizes'
import { canonicalizePairGenders, entryRuleLabel } from '@/lib/torneios/pairRules'
import {
  DEFAULT_ADVANCE_PER_GROUP,
  DEFAULT_GROUP_COUNT,
  FORMATS,
  hasGroupStage,
  isBracketFormat,
} from '@/lib/torneios/formats'
import { computeGroupTables, splitPhases } from '@/lib/torneios/schedule/grupos'
import { roundLabel as bracketRoundLabel } from '@/lib/torneios/bracket'
import { buildBracketColumns } from '@/lib/torneios/bracketView'
import { formatLabel, categoryLabel } from '@/lib/torneios/sportProfile'
import { teamLabel } from '@/lib/torneios/display'
import { MarkdownDoc } from '@/components/docs/MarkdownDoc'
import type { Tournament, ScoringConfig } from '@/types'
import type { MatchResultInput } from '@/lib/torneios/types'

interface PageProps { params: { id: string } }

function normalizeProf<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

// ---------------------------------------------------------------------------
// OG metadata (WhatsApp / Instagram preview)
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const adminClient = createAdminClient()
  const { data: t } = await adminClient
    .from('tournaments')
    .select('name, date, cover_image_url, description')
    .eq('id', params.id)
    .not('status', 'eq', 'draft')
    .single()

  if (!t) return { title: 'Torneio | ArenaHub' }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website'
  const images = t.cover_image_url
    ? [{ url: t.cover_image_url as string, width: 1200, height: 630 }]
    : []
  const dateStr = formatDate(t.date as string, "dd 'de' MMMM 'de' yyyy")
  const description = (t.description as string | null)?.trim() || `Torneio ${dateStr}`

  return {
    title: t.name as string,
    description,
    openGraph: {
      title: t.name as string,
      description,
      url: `${baseUrl}/t/${params.id}`,
      images,
      type: 'website',
    },
    twitter: {
      card: t.cover_image_url ? 'summary_large_image' : 'summary',
      title: t.name as string,
    },
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PublicTournamentPage({ params }: PageProps) {
  const adminClient = createAdminClient()

  const { data: tournamentRaw } = await adminClient
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .not('status', 'eq', 'draft')
    .single()

  if (!tournamentRaw) notFound()
  const t = tournamentRaw as Tournament

  // Torneio dentro de um evento ganha o caminho de volta para a capa — quem
  // chegou pelo link direto ainda descobre que existem outras categorias — e
  // herda descrição/regulamento/local quando o próprio campo estiver vazio
  // (lib/torneios/content.ts).
  const { data: eventRaw } = t.event_id
    ? await adminClient
        .from('tournament_events')
        .select('name, slug, description, rules, venue')
        .eq('id', t.event_id)
        .eq('is_published', true)
        .maybeSingle()
    : { data: null }
  const parentEvent = eventRaw as { name: string; slug: string; description: string | null; rules: string | null; venue: string | null } | null

  const resolvedContent = resolveTournamentContent({
    tournament: { description: t.description, rules: t.rules, venue: t.venue },
    event: parentEvent
      ? { name: parentEvent.name, slug: parentEvent.slug, description: parentEvent.description, rules: parentEvent.rules, venue: parentEvent.venue }
      : null,
  })

  const { data: prizesRaw } = await adminClient
    .from('tournament_prizes')
    .select('id, kind, position, description, value_cents, delivered_at')
    .eq('tournament_id', params.id)
  const prizes = sortPrizes((prizesRaw ?? []) as PrizeRow[])

  const regWindow = resolveRegistrationWindow(
    { status: t.status, registration_deadline: t.registration_deadline },
    new Date(),
  )

  // Inscritos, confrontos e fotos — a mesma leitura que a página logada do
  // aluno usa (app/(dashboard)/torneios/[id]/page.tsx), via admin client
  // porque a RLS de `profiles` bloqueia ler o nome de quem não é o próprio
  // usuário. Uma consulta só de entries serve três propósitos: nomes para a
  // classificação, a lista "inscritos em duplas" e achar a inscrição de
  // quem está vendo (se logado) — evitar três idas ao banco pela mesma tabela.
  const [{ data: entriesRaw }, { data: matchesRaw }, photos] = await Promise.all([
    adminClient
      .from('tournament_entries')
      .select(`id, player_id, partner_id, entry_status, offer_expires_at, created_at,
        payment_status, receipt_url, final_price_cents, discount_pct,
        partner_payment_status, partner_receipt_url, partner_final_price_cents, partner_discount_pct,
        player:profiles!tournament_entries_player_id_fkey(id, full_name),
        partner:profiles!tournament_entries_partner_id_fkey(id, full_name)`)
      .eq('tournament_id', params.id)
      .order('created_at', { ascending: true }),
    adminClient
      .from('tournament_matches')
      .select(`id, tournament_id, round, match_no, group_label,
        player1_id, player2_id, partner1_id, partner2_id,
        games1, games2, result_status, reported_by, confirmed_by, played_at,
        player1:profiles!player1_id(id, full_name),
        player2:profiles!player2_id(id, full_name),
        partner1:profiles!partner1_id(id, full_name),
        partner2:profiles!partner2_id(id, full_name)`)
      .eq('tournament_id', params.id)
      .order('round', { ascending: true })
      .order('match_no', { ascending: true }),
    getTournamentPhotos(t.organization_id, params.id),
  ])

  type EntryRow = {
    id: string; player_id: string; partner_id: string | null
    entry_status: 'confirmed' | 'waitlist' | 'offered'
    offer_expires_at: string | null; created_at: string
    payment_status: 'free' | 'pending' | 'paid'; receipt_url: string | null
    final_price_cents: number; discount_pct: number
    partner_payment_status: 'free' | 'pending' | 'paid' | null; partner_receipt_url: string | null
    partner_final_price_cents: number; partner_discount_pct: number
    player: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const entries = (entriesRaw ?? []) as unknown as EntryRow[]

  const nameById: Record<string, string> = {}
  for (const e of entries) {
    const p = normalizeProf(e.player)
    if (p) nameById[p.id] = p.full_name
    const pt = normalizeProf(e.partner)
    if (pt) nameById[pt.id] = pt.full_name
  }
  const confirmedEntries = entries.filter((e) => e.entry_status === 'confirmed')
  // Mesma contagem de availableSlots: 'offered' já ocupa vaga.
  const occupiedCount = entries.filter((e) => e.entry_status !== 'waitlist').length
  const waitlistCount = entries.filter((e) => e.entry_status === 'waitlist').length

  type ScoreMatchRaw = {
    id: string; tournament_id: string; round: number; match_no: number | null
    group_label: string | null
    player1_id: string | null; player2_id: string | null
    partner1_id: string | null; partner2_id: string | null
    games1: number | null; games2: number | null; result_status: string | null
    reported_by: string | null; confirmed_by: string | null; played_at: string | null
    player1: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    player2: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner1: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner2: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const matches = ((matchesRaw ?? []) as unknown as ScoreMatchRaw[]).map((m) => ({
    ...m,
    player1: normalizeProf(m.player1),
    player2: normalizeProf(m.player2),
    partner1: normalizeProf(m.partner1),
    partner2: normalizeProf(m.partner2),
  }))

  // Chave, grupos, classificação e confrontos são públicos só quando há algo
  // pra ver — antes disso (inscrições abertas) a resposta é sempre "ainda não
  // saiu", e mostrar tabelas vazias só faria a página parecer quebrada.
  const showResults = t.status === 'in_progress' || t.status === 'finished'

  const entryRefs = confirmedEntries.map((e) => ({ playerId: e.player_id, partnerId: e.partner_id ?? null }))
  const scoring: ScoringConfig = {
    sets_to_win: t.sets_to_win ?? 1,
    games_per_set: t.games_per_set ?? 6,
    tiebreak_games: t.tiebreak_games ?? true,
  }
  const normalized = matches.map((m) => ({
    ...m,
    result_status: m.result_status as 'pending' | 'confirmed' | null,
    group: m.group_label,
  }))

  const engine = FORMATS[t.format ?? 'americano']
  const standings = showResults && engine
    ? engine.computeStandings(entryRefs, normalized as unknown as MatchResultInput[], scoring)
    : []

  const { groupMatches, knockoutMatches, groupRounds } = splitPhases(normalized)
  const isBracket = isBracketFormat(t.format)
  const withGroups = hasGroupStage(t.format)
  const bracketColumns = showResults && isBracket ? buildBracketColumns(knockoutMatches, nameById, null) : []
  const knockoutRounds = knockoutMatches.length > 0 ? Math.max(...knockoutMatches.map((m) => m.round)) : 0

  const groupCount = t.group_count ?? DEFAULT_GROUP_COUNT
  const advancePerGroup = t.advance_per_group ?? DEFAULT_ADVANCE_PER_GROUP
  const groupTables =
    showResults && withGroups && groupMatches.length > 0
      ? computeGroupTables(entryRefs, normalized as unknown as MatchResultInput[], groupCount, scoring)
      : []

  const podium: PodiumPlace[] =
    t.status === 'finished'
      ? ([
          [1, t.winner1_id, t.winner1_partner_id],
          [2, t.winner2_id, t.winner2_partner_id],
          [3, t.winner3_id, t.winner3_partner_id],
        ] as const)
          .filter(([, id]) => !!id)
          .map(([position, id, partnerId]) => ({
            position: position as 1 | 2 | 3,
            label: teamLabel([nameById[id as string], partnerId ? nameById[partnerId] : null]),
            ids: [id as string, partnerId].filter((x): x is string => !!x),
          }))
      : []

  const roundsOfMatches = Array.from(
    matches.reduce((acc, m) => {
      acc.set(m.round, [...(acc.get(m.round) ?? []), m])
      return acc
    }, new Map<number, typeof matches>()),
  ).sort(([a], [b]) => a - b)

  const labelForRound = (round: number, group: string | null) => {
    if (group) return `Rodada ${round}`
    if (!isBracket || knockoutRounds === 0) return `Rodada ${round}`
    return bracketRoundLabel(round - groupRounds, knockoutRounds)
  }

  const toScoreMatch = (m: (typeof matches)[number]) => ({
    ...m,
    player1_id: m.player1_id ?? '',
    player2_id: m.player2_id ?? '',
    result_status: m.result_status as 'pending' | 'confirmed' | null,
    played_at: m.played_at,
  })

  // Verifica se usuário está logado e inscrito
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  type UserEntryData = {
    payment_status: 'free' | 'pending' | 'paid'
    receipt_url: string | null
    final_price_cents: number
    discount_pct: number
    entry_status: 'confirmed' | 'waitlist' | 'offered'
    offer_expires_at: string | null
    created_at: string
    paymentPath: string | null
  } | null
  let userEntry: UserEntryData = null
  if (user) {
    // Casa player_id OU partner_id: quem entrou como parceiro de dupla fixa
    // não encontrava a própria inscrição aqui — e a cobrança dele mora nas
    // colunas partner_*, não nas do titular.
    const entryRaw = entries.find((e) => e.player_id === user.id || e.partner_id === user.id)
    if (entryRaw) {
      const side = sideOfEntry(user.id, entryRaw)
      const charge = chargeFor(side ?? 'player', entryRaw as unknown as PayableEntry)
      let paymentPath: string | null = null
      if (charge.paymentStatus === 'pending') {
        try {
          const token = await ensureEntryPaymentToken(adminClient, {
            orgId: t.organization_id, tournamentId: t.id, entryId: entryRaw.id, side: side ?? 'player',
          })
          if (token) paymentPath = `/p/${token}`
        } catch (e) {
          console.error('[t/[id]] falha ao gerar link de pagamento', e)
        }
      }
      userEntry = {
        payment_status: (charge.paymentStatus ?? 'free') as 'free' | 'pending' | 'paid',
        receipt_url: charge.receiptUrl,
        final_price_cents: charge.finalPriceCents,
        discount_pct: charge.discountPct,
        entry_status: entryRaw.entry_status,
        offer_expires_at: entryRaw.offer_expires_at,
        created_at: entryRaw.created_at,
        paymentPath,
      }
    }
  }
  const isRegistered = userEntry !== null

  // Posição na lista de espera
  let waitlistPosition: number | null = null
  if (userEntry?.entry_status === 'waitlist') {
    const { count: pos } = await adminClient
      .from('tournament_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', params.id)
      .eq('entry_status', 'waitlist')
      .lte('created_at', userEntry.created_at)
    waitlistPosition = pos ?? null
  }

  const isPaid = (t.entry_price_cents ?? 0) > 0 && !!t.pix_key
  const formattedPrice = isPaid
    ? `R$ ${((t.entry_price_cents!) / 100).toFixed(2).replace('.', ',')}`
    : null

  const isOpen = t.status === 'open'
  const isFinished = t.status === 'finished'
  const isInProgress = t.status === 'in_progress'

  // Faixa de fatos: os dois eixos que confundiam o usuário. "Livre"/"Misto"
  // são sobre GÊNERO da dupla; "dupla fixa"/"dupla sorteada" são sobre QUEM
  // decide o parceiro — dois eixos independentes que o resto da tela nunca
  // separava com essa clareza.
  const allowedPairGenders = canonicalizePairGenders(t.allowed_pair_genders ?? [])
  const genderAxisLabel =
    entryRuleLabel(t.participant_type, allowedPairGenders) ??
    (t.category === 'livre'
      ? 'Livre — sem restrição de gênero'
      : t.category === 'misto'
        ? 'Misto — duplas mistas'
        : categoryLabel(t.category) ?? 'Livre')
  const participationAxisLabel =
    t.participant_type === 'dupla_fixa'
      ? 'Dupla fixa — você escolhe seu parceiro'
      : t.participant_type === 'dupla_revezando'
        ? 'Dupla sorteada — o parceiro muda a cada rodada'
        : 'Individual — você joga sozinho'
  const scoringLabel = `${t.games_per_set ?? 6} games por set${t.tiebreak_games ? ' com tiebreak' : ''}`

  return (
    <div className="min-h-screen bg-surface" style={{ maxWidth: 480, margin: '0 auto' }}>
      <div className="p-3">
        <TournamentHero
          tournament={t}
          occupiedCount={occupiedCount}
          waitlistCount={waitlistCount}
          backHref={parentEvent ? `/e/${parentEvent.slug}` : null}
          actions={<ShareButton path={`/t/${t.id}`} title={t.name} />}
        />
      </div>

      {/* CTA de inscrição/status — fica "grudado" no fim da tela ao rolar no
          celular (onde o scroll é longo e o CTA de topo desaparece rápido);
          no desktop volta a ser um cartão comum. */}
      <div className="sticky bottom-0 z-30 border-t border-surface-border bg-surface/95 px-3 py-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-3 sm:pb-0 sm:pt-0">
        <div className="bg-surface-card border border-surface-border rounded-xl p-4 space-y-3">
          {isOpen ? (
            <>
              {/* Preço e desconto */}
              {isPaid && !isRegistered && (
                <div>
                  {userEntry === null && (
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-white text-2xl font-bold">{formattedPrice}</span>
                    </div>
                  )}
                  <div className="bg-surface rounded-lg px-3 py-2 mt-2">
                    <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Chave PIX</p>
                    <p className="text-white text-sm font-mono break-all">{t.pix_key}</p>
                  </div>
                </div>
              )}

              {isRegistered && userEntry ? (
                <>
                  {/* Jogador confirmado */}
                  {userEntry.entry_status === 'confirmed' && (
                    <>
                      {userEntry.payment_status === 'paid' && (
                        <span className="block bg-green-800/40 text-green-400 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                          ✓ Pagamento confirmado
                        </span>
                      )}
                      {userEntry.payment_status === 'pending' && (
                        <div className="space-y-3">
                          <span className="block bg-yellow-800/40 text-yellow-400 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                            ⏳ Aguardando confirmação do pagamento
                          </span>
                          <div className="bg-surface rounded-lg px-3 py-2">
                            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Valor a pagar</p>
                            <p className="text-white text-lg font-bold">
                              R$ {(userEntry.final_price_cents / 100).toFixed(2).replace('.', ',')}
                              {userEntry.discount_pct > 0 && (
                                <span className="text-green-400 text-sm font-normal ml-2">({userEntry.discount_pct}% de desconto)</span>
                              )}
                            </p>
                          </div>
                          {userEntry.paymentPath ? (
                            <Link
                              href={userEntry.paymentPath}
                              className="block w-full rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 py-3 text-center text-sm font-semibold text-white hover:from-orange-500 hover:to-orange-400"
                            >
                              💳 Ir para o pagamento
                            </Link>
                          ) : (
                            <div className="bg-surface rounded-lg px-3 py-2">
                              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Chave PIX</p>
                              <p className="text-white text-sm font-mono break-all">{t.pix_key}</p>
                            </div>
                          )}
                        </div>
                      )}
                      {userEntry.payment_status === 'free' && (
                        <span className="block bg-green-800/40 text-green-400 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                          ✓ Você está inscrito
                        </span>
                      )}
                    </>
                  )}

                  {/* Na lista de espera */}
                  {userEntry.entry_status === 'waitlist' && (
                    <span className="block bg-slate-800/60 text-slate-300 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                      🕐 Você está na lista de espera{waitlistPosition !== null ? `, posição ${waitlistPosition}` : ''}
                    </span>
                  )}

                  {/* Vaga oferecida */}
                  {userEntry.entry_status === 'offered' && (
                    <>
                      {userEntry.offer_expires_at && new Date(userEntry.offer_expires_at) > new Date() ? (
                        <div className="space-y-3">
                          <span className="block bg-green-900/40 text-green-300 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                            🎉 Vaga disponível! Confirme até {new Date(userEntry.offer_expires_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
                          </span>
                          <ConfirmWaitlistButton tournamentId={t.id} />
                        </div>
                      ) : (
                        <span className="block bg-slate-800/60 text-slate-400 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                          ⏰ Sua oferta de vaga expirou. Você voltou para a fila.
                        </span>
                      )}
                    </>
                  )}
                </>
              ) : !regWindow.open ? (
                <span className="block bg-slate-800/60 text-slate-300 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
                  ⏰ {regWindow.reason}
                </span>
              ) : user ? (
                <div>
                  <RegisterExternalButton
                    tournamentId={t.id}
                    isPaid={isPaid}
                    finalPriceCents={isPaid ? (t.entry_price_cents ?? 0) : undefined}
                  />
                  {closingSoonLabel(t.registration_deadline, new Date()) && (
                    <p className="mt-2 text-center text-xs font-semibold text-amber-400">
                      {closingSoonLabel(t.registration_deadline, new Date())}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <Link
                    href={`/login?next=/t/${t.id}`}
                    className="block w-full bg-gradient-to-r from-orange-600 to-orange-500 text-white text-center rounded-xl py-3 text-base font-semibold hover:from-orange-500 hover:to-orange-400 transition-all"
                  >
                    {isPaid ? `Inscrever-se · ${formattedPrice}` : 'Inscrever-se'}
                  </Link>
                  <p className="text-slate-500 text-xs text-center mt-2">
                    Precisa de uma conta?{' '}
                    <Link href={`/t/${t.id}/cadastrar`} className="text-brand-500 hover:underline">
                      Cadastre-se grátis
                    </Link>
                  </p>
                  {deadlineLabel(t.registration_deadline) && (
                    <p className="mt-2 text-center text-xs text-slate-500">{deadlineLabel(t.registration_deadline)}</p>
                  )}
                </div>
              )}
            </>
          ) : isInProgress ? (
            <span className="block bg-red-900/30 text-red-300 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
              🔴 Acontecendo agora — acompanhe o placar abaixo
            </span>
          ) : isFinished ? (
            <span className="block bg-slate-800/60 text-slate-300 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
              🏁 Torneio encerrado — veja o resultado abaixo
            </span>
          ) : null}
        </div>
      </div>

      {/* Faixa de fatos */}
      <div className="px-3 mt-3 grid grid-cols-2 gap-2">
        <div className="bg-surface-card border border-surface-border rounded-xl px-3 py-2">
          <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wide">Categoria</p>
          <p className="text-white text-xs font-medium mt-0.5">{genderAxisLabel}</p>
        </div>
        <div className="bg-surface-card border border-surface-border rounded-xl px-3 py-2">
          <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wide">Participação</p>
          <p className="text-white text-xs font-medium mt-0.5">{participationAxisLabel}</p>
        </div>
        <div className="bg-surface-card border border-surface-border rounded-xl px-3 py-2">
          <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wide">Formato</p>
          <p className="text-white text-xs font-medium mt-0.5">{formatLabel(t.format, t.max_players)}</p>
        </div>
        <div className="bg-surface-card border border-surface-border rounded-xl px-3 py-2">
          <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wide">Pontuação</p>
          <p className="text-white text-xs font-medium mt-0.5">{scoringLabel}</p>
        </div>
      </div>

      {/* Descrição */}
      {resolvedContent.description && (
        <div className="px-3 mt-3">
          <p className="text-slate-300 text-sm leading-relaxed">{resolvedContent.description.text}</p>
        </div>
      )}

      {/* Local e horário */}
      {(resolvedContent.venue || t.start_time) && (
        <div className="px-3 mt-3 space-y-1">
          {resolvedContent.venue && (
            <p className="text-slate-400 text-sm flex items-start gap-1.5">
              <span aria-hidden>📍</span>
              <span>
                {resolvedContent.venue.text}
                {resolvedContent.venue.origin === 'event' && (
                  <span className="text-slate-600"> · local do evento {resolvedContent.venue.sourceName}</span>
                )}
              </span>
            </p>
          )}
          {t.start_time && (
            <p className="text-slate-400 text-sm flex items-center gap-1.5">
              <span aria-hidden>🕗</span>
              <span>Início às {t.start_time.slice(0, 5)}</span>
            </p>
          )}
        </div>
      )}

      {/* Premiação */}
      {prizes.length > 0 && (
        <div className="px-3 mt-3">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2">🏆 Premiação</p>
          <div className="bg-surface-card border border-surface-border rounded-xl p-3 space-y-1.5">
            {prizes.map((p) => (
              <p key={p.id} className="text-sm text-slate-300">
                <span className="font-semibold text-white">
                  {p.kind === 'podium' ? positionLabel(p.position as number) : 'Especial'}:
                </span>{' '}
                {p.description}
                {p.value_cents !== null && (
                  <span className="text-green-400"> · R$ {(p.value_cents / 100).toFixed(2).replace('.', ',')}</span>
                )}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Regulamento — recolhido por padrão: é referência, não a primeira coisa que se lê */}
      {resolvedContent.rules && (
        <div className="px-3 mt-3">
          <details className="bg-surface-card border border-surface-border rounded-xl p-3">
            <summary className="text-sm font-semibold text-white cursor-pointer">
              📋 Regulamento
              {resolvedContent.rules.origin === 'event' && (
                <span className="ml-1.5 text-xs font-normal text-slate-500">
                  (do evento {resolvedContent.rules.sourceName})
                </span>
              )}
            </summary>
            <div className="mt-3">
              <MarkdownDoc content={resolvedContent.rules.text} />
            </div>
          </details>
        </div>
      )}

      {/* Inscritos — em duplas quando é dupla fixa, porque "quem está com
          quem" é justamente o que se procura nesse formato. */}
      {confirmedEntries.length > 0 && (
        <div className="px-3 mt-3">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2">
            {confirmedEntries.length} {confirmedEntries.length === 1 ? 'inscrito' : 'inscritos'}
          </p>
          {t.participant_type === 'dupla_fixa' ? (
            <ul className="space-y-1.5">
              {confirmedEntries.map((e) => {
                const p = normalizeProf(e.player)
                const pt = normalizeProf(e.partner)
                return (
                  <li
                    key={e.id}
                    className="bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-xs text-slate-300"
                  >
                    {p?.full_name ?? '—'} / {pt ? pt.full_name : <span className="text-amber-400">convite pendente</span>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {confirmedEntries.slice(0, 8).map((e) => {
                const p = normalizeProf(e.player)
                if (!p) return null
                const abbr = p.full_name.split(' ').slice(0, 2).map((n, i) => (i === 0 ? n : n[0] + '.')).join(' ')
                return (
                  <span key={e.id} className="bg-surface-card text-slate-400 text-xs px-2.5 py-1 rounded-full border border-surface-border">
                    {abbr}
                  </span>
                )
              })}
              {confirmedEntries.length > 8 && (
                <span className="bg-surface-card text-slate-400 text-xs px-2.5 py-1 rounded-full border border-surface-border">
                  +{confirmedEntries.length - 8}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pódio */}
      {podium.length > 0 && (
        <div className="px-3 mt-4">
          <SectionTitle icon={Trophy}>Pódio</SectionTitle>
          <PodiumCard places={podium} />
        </div>
      )}

      {/* Fase de grupos */}
      {groupTables.length > 0 && (
        <div className="px-3 mt-4">
          <SectionTitle icon={LayoutGrid}>Fase de grupos</SectionTitle>
          <GroupTables tables={groupTables} nameById={nameById} advancePerGroup={advancePerGroup} settled={knockoutMatches.length > 0} />
        </div>
      )}

      {/* Chave */}
      {bracketColumns.length > 0 && (
        <div className="px-3 mt-4">
          <SectionTitle icon={Swords}>{withGroups ? 'Mata-mata' : 'Chave'}</SectionTitle>
          <BracketView columns={bracketColumns} />
        </div>
      )}

      {/* Classificação */}
      {standings.length > 0 && (
        <div className="px-3 mt-4">
          <SectionTitle icon={ListOrdered}>Classificação</SectionTitle>
          <StandingsTable rows={standings} nameById={nameById} />
        </div>
      )}

      {/* Todos os confrontos — leitura, sem lançar/confirmar placar nem marcar
          data/hora: essas ações continuam só para quem joga (dashboard). */}
      {showResults && matches.length > 0 && (
        <div className="px-3 mt-4">
          <SectionTitle icon={CalendarClock}>Confrontos</SectionTitle>
          <div className="space-y-5">
            {roundsOfMatches.map(([round, roundMatches]) => (
              <div key={round}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  {labelForRound(round, roundMatches[0]?.group_label ?? null)}
                </h3>
                <div className="space-y-2">
                  {roundMatches.map((match) => (
                    <MatchScoreCard key={match.id} match={toScoreMatch(match)} isAdmin={false} readOnly />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mural de fotos */}
      <div className="px-3 mt-4">
        <PhotoGallery photos={photos} title="MURAL DO TORNEIO" />
      </div>

      {/* Footer */}
      <div className="px-3 py-6 mt-4 border-t border-surface-border text-center">
        <PoweredBy className="justify-center" />
      </div>
    </div>
  )
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Trophy; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-white">
      <Icon className="h-4 w-4 text-brand-500" aria-hidden />
      {children}
    </h2>
  )
}
