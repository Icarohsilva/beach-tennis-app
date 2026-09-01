// app/(admin)/admin/torneios/[id]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { MatchScoreCard } from '@/features/torneios/MatchScoreCard'
import { StandingsTable } from '@/features/torneios/StandingsTable'
import { ParticipantModalProvider } from '@/features/torneios/ParticipantModal'
import { ParticipantName } from '@/features/torneios/ParticipantName'
import { GenerateBracketButton } from './GenerateBracketButton'
import { SeedKnockoutButton } from './SeedKnockoutButton'
import { CoverImageCard } from './CoverImageCard'
import { CloseTournamentButton } from './CloseTournamentButton'
import { WinnersCard } from './WinnersCard'
import { PhotosCard } from './PhotosCard'
import { getTournamentPhotos } from '@/features/torneios/photoQueries'
import { ConfirmPaymentButton } from './ConfirmPaymentButton'
import { CancelForNonPaymentButton } from './CancelForNonPaymentButton'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import { ensureEntryPaymentToken } from '@/features/torneios/entryPaymentActions'
import { inviteState } from '@/lib/torneios/invite'
import { PairFixControls } from './PairFixControls'
import { EnrollParticipantCard } from './EnrollParticipantCard'
import { SendAccessButton } from './SendAccessButton'
import { formatDate } from '@/lib/utils/dateHelpers'
import { FORMATS } from '@/lib/torneios/formats'
import type { Tournament, TournamentStatus, ScoringConfig } from '@/types'
import type { MatchResultInput } from '@/lib/torneios/types'
import { requirePlatformAccess } from '@/lib/billing/guard'

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Rascunho',
  open: 'Inscrições Abertas',
  in_progress: 'Em Andamento',
  finished: 'Encerrado',
}

function normalizeProf<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

interface PageProps { params: { id: string } }

export default async function AdminTorneioDetailPage({ params }: PageProps) {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  if (!orgId) notFound()

  const { data: tournament, error } = await adminClient
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .single()
  if (error || !tournament) notFound()

  const t = tournament as Tournament

  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle()
  const orgName = (orgRow as { name: string } | null)?.name ?? 'a academia'

  // Entradas (tournament_entries) com nome do jogador
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select(`id, player_id, partner_id, seed, created_at,
      payment_status, discount_pct, final_price_cents, receipt_url,
      partner_payment_status, partner_discount_pct, partner_final_price_cents, partner_receipt_url,
      entry_status, offer_expires_at,
      player:profiles!tournament_entries_player_id_fkey(id, full_name, gender, phone),
      partner:profiles!tournament_entries_partner_id_fkey(id, full_name, phone)`)
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })

  type EntryRow = {
    id: string; player_id: string; partner_id: string | null; seed: number | null; created_at: string
    payment_status: 'free' | 'pending' | 'paid'
    discount_pct: number
    final_price_cents: number
    receipt_url: string | null
    partner_payment_status: 'free' | 'pending' | 'paid' | null
    partner_discount_pct: number
    partner_final_price_cents: number
    partner_receipt_url: string | null
    entry_status: 'confirmed' | 'waitlist' | 'offered'
    offer_expires_at: string | null
    player: { id: string; full_name: string; gender: string | null; phone: string | null } | { id: string; full_name: string; gender: string | null; phone: string | null }[] | null
    partner: { id: string; full_name: string; phone: string | null } | { id: string; full_name: string; phone: string | null }[] | null
  }
  const entries = (entriesRaw ?? []) as unknown as EntryRow[]

  // Link pessoal de pagamento por lado (features/torneios/entryPaymentActions.ts):
  // gerado aqui (idempotente) para a mensagem de cobrança do admin levar o
  // link certo em vez da chave PIX solta — o link já mostra valor, desconto
  // e o jeito de pagar daquela pessoa.
  const paymentTokens: Record<string, { player?: string; partner?: string }> = {}
  await Promise.all(
    entries.flatMap((e) => {
      const jobs: Promise<void>[] = []
      if (e.payment_status === 'pending') {
        jobs.push(
          ensureEntryPaymentToken(adminClient, { orgId, tournamentId: t.id, entryId: e.id, side: 'player' })
            .then((token) => { if (token) (paymentTokens[e.id] ??= {}).player = token })
            .catch((err) => console.error('[admin/torneios] falha ao gerar link de pagamento (titular)', err)),
        )
      }
      if (e.partner_payment_status === 'pending') {
        jobs.push(
          ensureEntryPaymentToken(adminClient, { orgId, tournamentId: t.id, entryId: e.id, side: 'partner' })
            .then((token) => { if (token) (paymentTokens[e.id] ??= {}).partner = token })
            .catch((err) => console.error('[admin/torneios] falha ao gerar link de pagamento (parceiro)', err)),
        )
      }
      return jobs
    }),
  )

  // "Duplas incompletas": inscrições de dupla fixa sem parceiro — convite
  // nunca respondido, expirado ou recusado. Ficam presas esperando um link
  // que talvez nunca seja aberto; o admin resolve aqui em vez de apagar a
  // inscrição (perdendo pagamento, seed e posição na fila do titular).
  const isDuplaFixa = t.participant_type === 'dupla_fixa'
  const incompleteEntries = isDuplaFixa
    ? entries.filter((e) => !e.partner_id && e.entry_status !== 'offered')
    : []

  type InviteStatus = { state: 'pending' | 'accepted' | 'declined' | 'expired'; invitedName: string }
  const inviteByEntry: Record<string, InviteStatus> = {}
  if (incompleteEntries.length > 0) {
    const { data: invitesRaw } = await adminClient
      .from('tournament_partner_invites')
      .select('entry_id, invited_name, expires_at, accepted_at, declined_at')
      .in('entry_id', incompleteEntries.map((e) => e.id))
    for (const inv of (invitesRaw ?? []) as {
      entry_id: string; invited_name: string; expires_at: string
      accepted_at: string | null; declined_at: string | null
    }[]) {
      inviteByEntry[inv.entry_id] = {
        state: inviteState(
          { expires_at: inv.expires_at, accepted_at: inv.accepted_at, declined_at: inv.declined_at },
          new Date(),
        ),
        invitedName: inv.invited_name,
      }
    }
  }

  // Candidatos a parceiro para o painel de conserto de dupla: alunos/atletas
  // ativos desta academia, menos quem já está em alguma dupla deste torneio
  // (dos dois lados) — inclui o próprio titular de cada inscrição, então
  // ninguém vira "parceiro de si mesmo" na lista.
  let pairCandidates: { id: string; full_name: string }[] = []
  if (isDuplaFixa && t.status === 'open') {
    const pairedIds = new Set(
      entries.flatMap((e) => [e.player_id, e.partner_id].filter((id): id is string => Boolean(id))),
    )
    const { data: membRaw } = await adminClient
      .from('memberships')
      .select('user_id, profiles:profiles!memberships_user_id_fkey(full_name)')
      .eq('organization_id', orgId)
      .in('role', ['student', 'athlete'])
      .is('archived_at', null)
    type MembRow = { user_id: string; profiles: { full_name: string } | { full_name: string }[] | null }
    pairCandidates = ((membRaw ?? []) as unknown as MembRow[])
      .filter((m) => !pairedIds.has(m.user_id))
      .map((m) => {
        const prof = normalizeProf(m.profiles as { full_name: string } | { full_name: string }[])
        return { id: m.user_id, full_name: prof?.full_name ?? '' }
      })
      .filter((p) => p.full_name)
  }

  // Signed URLs para comprovantes (válidas por 5 min) — paralelas para evitar N+1.
  // Duas chaves por entry (titular e parceiro): a dupla fixa é cobrada por
  // atleta, cada um com o próprio comprovante.
  const receiptSignedUrls: Record<string, string> = {}
  const partnerReceiptSignedUrls: Record<string, string> = {}
  await Promise.all([
    ...entries
      .filter((e) => e.receipt_url)
      .map(async (e) => {
        const { data: signed, error: signErr } = await adminClient.storage
          .from('payment-receipts')
          .createSignedUrl(e.receipt_url as string, 300)
        if (signErr) console.error('[receipt] signedUrl failed for entry', e.id, signErr.message)
        else if (signed?.signedUrl) receiptSignedUrls[e.id] = signed.signedUrl
      }),
    ...entries
      .filter((e) => e.partner_receipt_url)
      .map(async (e) => {
        const { data: signed, error: signErr } = await adminClient.storage
          .from('payment-receipts')
          .createSignedUrl(e.partner_receipt_url as string, 300)
        if (signErr) console.error('[receipt] signedUrl failed for partner of entry', e.id, signErr.message)
        else if (signed?.signedUrl) partnerReceiptSignedUrls[e.id] = signed.signedUrl
      }),
  ])

  // Confrontos com colunas de placar/status
  const { data: matchesRaw } = await adminClient
    .from('tournament_matches')
    .select(`id, tournament_id, round, match_no,
      player1_id, player2_id, partner1_id, partner2_id,
      games1, games2, result_status, reported_by, confirmed_by, played_at,
      player1:profiles!player1_id(id, full_name),
      player2:profiles!player2_id(id, full_name),
      partner1:profiles!partner1_id(id, full_name),
      partner2:profiles!partner2_id(id, full_name)`)
    .eq('tournament_id', params.id)
    .order('round', { ascending: true })
    .order('match_no', { ascending: true })

  type ScoreMatchRaw = {
    id: string; tournament_id: string; round: number; match_no: number | null
    player1_id: string | null; player2_id: string | null; partner1_id: string | null; partner2_id: string | null
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

  // Classificação computada no servidor pelo formato
  const entryRefs = entries.filter((e) => e.entry_status === 'confirmed').map((e) => ({ playerId: e.player_id, partnerId: e.partner_id ?? null }))
  const scoring: ScoringConfig = {
    sets_to_win: t.sets_to_win ?? 1,
    games_per_set: t.games_per_set ?? 6,
    tiebreak_games: t.tiebreak_games ?? true,
  }
  const fmt = FORMATS[t.format ?? 'americano']
  const standings = fmt ? fmt.computeStandings(entryRefs, matches as unknown as MatchResultInput[], scoring) : []

  const nameById: Record<string, string> = {}
  for (const e of entries) {
    const p = normalizeProf(e.player)
    if (p) nameById[p.id] = p.full_name
    const pt = normalizeProf(e.partner)
    if (pt) nameById[pt.id] = pt.full_name
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website'
  const shareUrl = `${baseUrl}/t/${t.id}`
  const isFinished = t.status === 'finished'

  const photos = await getTournamentPhotos(orgId, params.id)

  // Lista de jogadores para o WinnersCard
  const allPlayers = entries
    .map((e) => normalizeProf(e.player))
    .filter(Boolean)
    .map((p) => p as { id: string; full_name: string })

  // Separar entradas por status
  const confirmedEntries = entries.filter((e) => e.entry_status === 'confirmed')
  const offeredEntries = entries.filter((e) => e.entry_status === 'offered')
  const waitlistEntries = entries.filter((e) => e.entry_status === 'waitlist')
  const maxPlayers = t.max_players

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const heroChips = [
    formatDate(t.date, "dd 'de' MMMM 'de' yyyy"),
    STATUS_LABELS[t.status],
    t.sport ? cap(t.sport) : null,
    t.format ? cap(t.format) : null,
    t.category ? cap(t.category) : null,
  ].filter(Boolean) as string[]

  // Helper: tempo restante até expiração da oferta
  function formatTimeUntil(isoDate: string): string {
    const ms = new Date(isoDate).getTime() - Date.now()
    if (ms <= 0) return 'Expirada'
    const hours = Math.floor(ms / (1000 * 60 * 60))
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }

  return (
    // Um modal para a página inteira; cada nome só pede para abri-lo.
    <ParticipantModalProvider tournamentId={t.id}>
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5">
        <Link
          href="/admin/torneios"
          className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
          aria-label="Voltar"
        >
          ←
        </Link>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold leading-tight text-white">{t.name}</h1>
          <Link
            href={`/admin/torneios/${t.id}/editar`}
            className="shrink-0 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
          >
            Configurar
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {heroChips.map((c) => (
            <span key={c} className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* Ações rápidas */}
      <div className="grid gap-3 sm:grid-cols-2">
        <CoverImageCard
          tournamentId={t.id}
          coverImageUrl={t.cover_image_url ?? null}
          shareUrl={shareUrl}
        />
        <div className="space-y-3">
          <Card>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Ações</p>
            <div className="flex flex-wrap gap-2">
              {t.status === 'open' && <GenerateBracketButton tournamentId={t.id} />}
              {/* Só faz sentido com a fase de grupos rolando: antes não há
                  tabela, depois a chave já existe. */}
              {t.format === 'grupos' && t.status === 'in_progress' && (
                <SeedKnockoutButton tournamentId={t.id} />
              )}
              {t.status !== 'finished' && (
                <CloseTournamentButton tournamentId={t.id} />
              )}
              {/* Mesmo limite do servidor (enrollExternalEntry): depois que a
                  chave sai (in_progress) uma inscrição avulsa ficaria de fora
                  dela e da classificação. */}
              {t.status !== 'in_progress' && t.status !== 'finished' && (
                <EnrollParticipantCard
                  tournamentId={t.id}
                  tournamentName={t.name}
                  tournamentUrl={shareUrl}
                  orgName={orgName}
                  isDuplaFixa={t.participant_type === 'dupla_fixa'}
                />
              )}
            </div>
          </Card>
          <WinnersCard
            tournamentId={t.id}
            isFinished={isFinished}
            winner1Id={t.winner1_id ?? null}
            winner2Id={t.winner2_id ?? null}
            winner3Id={t.winner3_id ?? null}
            allPlayers={allPlayers}
          />
        </div>
      </div>

      <PhotosCard tournamentId={t.id} photos={photos} />

      {/* Inscrições */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">
          {maxPlayers
            ? `Inscrições: ${confirmedEntries.length + offeredEntries.length} / ${maxPlayers} vagas`
            : `Inscrições (${confirmedEntries.length} confirmados)`}
        </h2>

        {/* Duplas incompletas — convite nunca respondido, expirado ou
            recusado. Fica no topo porque é a que precisa de ação do admin;
            as demais seções são só leitura na maior parte do tempo. */}
        {incompleteEntries.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wide mb-2">
              ⚠ Duplas incompletas ({incompleteEntries.length})
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {incompleteEntries.map((entry) => {
                const p = normalizeProf(entry.player)
                const invite = inviteByEntry[entry.id]
                const inviteLabel = !invite
                  ? 'Nenhum convite enviado ainda'
                  : invite.state === 'pending'
                    ? `Convite enviado a ${invite.invitedName} — aguardando resposta`
                    : invite.state === 'expired'
                      ? `Convite a ${invite.invitedName} expirou`
                      : invite.state === 'declined'
                        ? `${invite.invitedName} recusou o convite`
                        : `Convite a ${invite.invitedName} aceito` // não deveria aparecer aqui (partner_id já estaria preenchido)
                return (
                  <Card key={entry.id}>
                    <ParticipantName
                      playerId={entry.player_id}
                      name={p?.full_name ?? entry.player_id}
                      className="block text-sm font-medium text-white"
                    />
                    <p className="text-xs text-slate-400 mt-0.5">{inviteLabel}</p>
                    {t.status === 'open' && (
                      <PairFixControls entryId={entry.id} hasPartner={false} candidates={pairCandidates} />
                    )}
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {/* ① Confirmados */}
        {confirmedEntries.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Confirmados</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {confirmedEntries.map((entry) => {
                const p = normalizeProf(entry.player)
                const pt = normalizeProf(entry.partner)
                const playerPayToken = paymentTokens[entry.id]?.player
                const partnerPayToken = paymentTokens[entry.id]?.partner
                const waUrl = entry.payment_status === 'pending' && p?.phone && playerPayToken
                  ? buildWhatsAppUrl(
                      p.phone,
                      `Olá ${p.full_name}! Sua inscrição no torneio ${t.name} aguarda pagamento de R$ ${(entry.final_price_cents / 100).toFixed(2).replace('.', ',')}. Pague por aqui: ${getSiteUrl()}/p/${playerPayToken}`,
                    )
                  : null
                const partnerWaUrl = entry.partner_payment_status === 'pending' && pt?.phone && partnerPayToken
                  ? buildWhatsAppUrl(
                      pt.phone,
                      `Olá ${pt.full_name}! Sua inscrição no torneio ${t.name} (dupla com ${p?.full_name ?? ''}) aguarda pagamento de R$ ${(entry.partner_final_price_cents / 100).toFixed(2).replace('.', ',')}. Pague por aqui: ${getSiteUrl()}/p/${partnerPayToken}`,
                    )
                  : null
                return (
                  <Card key={entry.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <ParticipantName
                          playerId={entry.player_id}
                          name={p?.full_name ?? entry.player_id}
                          className="block text-sm font-medium text-white"
                        />
                        {p && (
                          <SendAccessButton
                            tournamentId={t.id}
                            playerId={p.id}
                            playerName={p.full_name}
                            playerPhone={p.phone}
                            tournamentName={t.name}
                            tournamentUrl={shareUrl}
                            orgName={orgName}
                          />
                        )}
                        {pt && (
                          <p className="text-xs text-slate-400">
                            Parceiro: {pt.full_name}
                            {entry.partner_payment_status === 'paid' && (
                              <span className="ml-1 text-green-400">· pago</span>
                            )}
                            {entry.partner_payment_status === 'pending' && (
                              <span className="ml-1 text-yellow-400">
                                · pendente R$ {(entry.partner_final_price_cents / 100).toFixed(2).replace('.', ',')}
                              </span>
                            )}
                          </p>
                        )}
                        {pt && (
                          <SendAccessButton
                            tournamentId={t.id}
                            playerId={pt.id}
                            playerName={pt.full_name}
                            playerPhone={pt.phone}
                            tournamentName={t.name}
                            tournamentUrl={shareUrl}
                            orgName={orgName}
                          />
                        )}
                        {entry.payment_status === 'pending' && (
                          <p className="text-xs text-yellow-400 mt-0.5">
                            Aguardando: R$ {(entry.final_price_cents / 100).toFixed(2).replace('.', ',')}
                            {entry.discount_pct > 0 && ` (${entry.discount_pct}% desc.)`}
                          </p>
                        )}
                        {entry.payment_status === 'paid' && (
                          <p className="text-xs text-green-400 mt-0.5">
                            Pago: R$ {(entry.final_price_cents / 100).toFixed(2).replace('.', ',')}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {entry.payment_status === 'free' && (
                          <span className="text-xs text-slate-500 bg-surface rounded px-1.5 py-0.5">Gratuito</span>
                        )}
                        {entry.payment_status === 'paid' && (
                          <span className="text-xs text-green-400 bg-green-900/30 rounded px-1.5 py-0.5">✓ Pago</span>
                        )}
                        {entry.payment_status === 'pending' && (
                          <span className="text-xs text-yellow-400 bg-yellow-900/30 rounded px-1.5 py-0.5">⏳ Pendente</span>
                        )}
                      </div>
                    </div>
                    {receiptSignedUrls[entry.id] && (
                      <div className="mt-2">
                        <a
                          href={receiptSignedUrls[entry.id]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-400 hover:text-brand-300"
                        >
                          📎 Ver comprovante (titular)
                        </a>
                      </div>
                    )}
                    {partnerReceiptSignedUrls[entry.id] && (
                      <div className="mt-2">
                        <a
                          href={partnerReceiptSignedUrls[entry.id]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-400 hover:text-brand-300"
                        >
                          📎 Ver comprovante (parceiro)
                        </a>
                      </div>
                    )}
                    {entry.payment_status === 'pending' && (
                      <div className="mt-2 flex flex-wrap gap-2 items-center">
                        <ConfirmPaymentButton entryId={entry.id} />
                        {waUrl && (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-green-400 hover:text-green-300"
                          >
                            📱 Cobrar titular via WhatsApp
                          </a>
                        )}
                      </div>
                    )}
                    {entry.partner_payment_status === 'pending' && (
                      <div className="mt-2 flex flex-wrap gap-2 items-center">
                        <ConfirmPaymentButton entryId={entry.id} side="partner" />
                        {partnerWaUrl && (
                          <a
                            href={partnerWaUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-green-400 hover:text-green-300"
                          >
                            📱 Cobrar parceiro via WhatsApp
                          </a>
                        )}
                      </div>
                    )}
                    {entry.payment_status === 'pending' && (
                      <CancelForNonPaymentButton entryId={entry.id} />
                    )}
                    {isDuplaFixa && pt && t.status === 'open' && (
                      <PairFixControls entryId={entry.id} hasPartner candidates={pairCandidates} />
                    )}
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {/* ② Ofertas pendentes */}
        {offeredEntries.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Vaga oferecida</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {offeredEntries.map((entry) => {
                const p = normalizeProf(entry.player)
                const expiresAt = entry.offer_expires_at as string | null
                const expired = expiresAt ? new Date(expiresAt) < new Date() : false
                const waUrl = p?.phone
                  ? buildWhatsAppUrl(
                      p.phone,
                      `Olá ${p.full_name}! Uma vaga abriu no torneio ${t.name}. Acesse ${shareUrl} e confirme sua inscrição em até 48h.`,
                    )
                  : null
                return (
                  <Card key={entry.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <ParticipantName
                          playerId={entry.player_id}
                          name={p?.full_name ?? entry.player_id}
                          className="block text-sm font-medium text-white"
                        />
                        {expired ? (
                          <span className="text-xs text-slate-400 bg-slate-800 rounded px-1.5 py-0.5 mt-1 inline-block">
                            Expirada, será reprocessada na próxima ação
                          </span>
                        ) : (
                          <span className="text-xs text-yellow-400 bg-yellow-900/30 rounded px-1.5 py-0.5 mt-1 inline-block">
                            Vaga oferecida · Expira em {expiresAt ? formatTimeUntil(expiresAt) : '?'}
                          </span>
                        )}
                      </div>
                    </div>
                    {waUrl && (
                      <div className="mt-2">
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-green-400 hover:text-green-300"
                        >
                          📱 Notificar via WhatsApp
                        </a>
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {/* ③ Lista de espera */}
        {waitlistEntries.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Lista de espera</p>
            <div className="space-y-1">
              {waitlistEntries.map((entry, idx) => {
                const p = normalizeProf(entry.player)
                return (
                  <div key={entry.id} className="flex items-center gap-3 py-1.5 px-3 bg-surface-card rounded-lg border border-surface-border">
                    <span className="text-xs text-slate-500 font-mono w-6">#{idx + 1}</span>
                    <ParticipantName
                      playerId={entry.player_id}
                      name={p?.full_name ?? entry.player_id}
                      className="flex-1 text-sm text-white"
                    />
                    <span className="text-xs text-slate-500">
                      {new Date(entry.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {entries.length === 0 && (
          <p className="text-slate-400 text-sm">Nenhuma inscrição ainda.</p>
        )}
      </section>

      {/* Classificação */}
      {standings.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Classificação</h2>
          <StandingsTable rows={standings} nameById={nameById} linkToProfile />
        </section>
      )}

      {/* Confrontos */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Confrontos</h2>
        {matches.length === 0 ? (
          <p className="text-slate-400 text-sm">Nenhum confronto gerado ainda.</p>
        ) : (
          <div className="space-y-8">
            {Array.from(
              matches.reduce((acc, m) => {
                acc.set(m.round, [...(acc.get(m.round) ?? []), m])
                return acc
              }, new Map<number, typeof matches>()),
            )
              .sort(([a], [b]) => a - b)
              .map(([round, roundMatches]) => (
                <div key={round}>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    Rodada {round}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {roundMatches.map((match) => (
                      <MatchScoreCard
                        key={match.id}
                        match={{
                          ...match,
                          player1_id: match.player1_id ?? '',
                          player2_id: match.player2_id ?? '',
                          result_status: match.result_status as 'pending' | 'confirmed' | null,
                          played_at: match.played_at,
                        }}
                        isAdmin
                        currentUserId=""
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
    </ParticipantModalProvider>
  )
}
