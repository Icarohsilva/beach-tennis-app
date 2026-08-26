// app/(public)/t/[id]/page.tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils/dateHelpers'
import { sportLabel } from '@/lib/arenas/sports'
import { RegisterExternalButton } from './RegisterExternalButton'
import { ShareButton } from './ShareButton'
import { ConfirmWaitlistButton } from './ConfirmWaitlistButton'
import { sideOfEntry, chargeFor, type PayableEntry } from '@/lib/torneios/entrySide'
import { ensureEntryPaymentToken } from '@/features/torneios/entryPaymentActions'
import { resolveTournamentContent } from '@/lib/torneios/content'
import { resolveRegistrationWindow, deadlineLabel, closingSoonLabel } from '@/lib/torneios/registrationWindow'
import { sortPrizes, positionLabel, type PrizeRow } from '@/lib/torneios/prizes'
import { MarkdownDoc } from '@/components/docs/MarkdownDoc'
import type { TournamentStatus } from '@/types'

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
    .select('id, organization_id, name, date, sport, category, level, status, cover_image_url, winner1_id, winner2_id, winner3_id, entry_price_cents, pix_key, max_players, event_id, description, rules, venue, start_time, registration_deadline')
    .eq('id', params.id)
    .not('status', 'eq', 'draft')
    .single()

  if (!tournamentRaw) notFound()

  type TRow = {
    id: string; organization_id: string; name: string; date: string; sport: string; category: string
    level: string; status: string; cover_image_url: string | null
    winner1_id: string | null; winner2_id: string | null; winner3_id: string | null
    entry_price_cents: number | null; pix_key: string | null
    max_players: number | null
    event_id: string | null
    description: string | null; rules: string | null; venue: string | null
    start_time: string | null; registration_deadline: string | null
  }
  const t = tournamentRaw as unknown as TRow

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
    { status: t.status as TournamentStatus, registration_deadline: t.registration_deadline },
    new Date(),
  )

  // Inscritos
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select('player_id, player:profiles!tournament_entries_player_id_fkey(id, full_name)')
    .eq('tournament_id', params.id)
    .eq('entry_status', 'confirmed')
    .order('created_at', { ascending: true })

  type EntryRow = {
    player_id: string
    player: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const entries = (entriesRaw ?? []) as unknown as EntryRow[]
  const players = entries.map((e) => normalizeProf(e.player)).filter(Boolean) as { id: string; full_name: string }[]

  // Nomes dos vencedores
  const winnerIds = [t.winner1_id, t.winner2_id, t.winner3_id].filter((id): id is string => Boolean(id))
  const { data: winnerProfilesRaw } = winnerIds.length > 0
    ? await adminClient.from('profiles').select('id, full_name').in('id', winnerIds)
    : { data: [] }
  const winnerNames = new Map<string, string>()
  for (const p of (winnerProfilesRaw ?? []) as { id: string; full_name: string }[]) {
    winnerNames.set(p.id, p.full_name)
  }

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
    // não encontrava a própria inscrição aqui (o filtro só olhava player_id) —
    // e a cobrança dele mora nas colunas partner_*, não nas do titular.
    const { data: entryRaw } = await adminClient
      .from('tournament_entries')
      .select(
        'id, player_id, partner_id, payment_status, receipt_url, final_price_cents, discount_pct, partner_payment_status, partner_receipt_url, partner_final_price_cents, partner_discount_pct, entry_status, offer_expires_at, created_at',
      )
      .eq('tournament_id', params.id)
      .or(`player_id.eq.${user.id},partner_id.eq.${user.id}`)
      .maybeSingle()
    if (entryRaw) {
      const side = sideOfEntry(user.id, entryRaw as { player_id: string; partner_id: string | null })
      const charge = chargeFor(side ?? 'player', entryRaw as unknown as PayableEntry)
      let paymentPath: string | null = null
      if (charge.paymentStatus === 'pending') {
        try {
          const token = await ensureEntryPaymentToken(adminClient, {
            orgId: t.organization_id, tournamentId: t.id, entryId: entryRaw.id as string, side: side ?? 'player',
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
        entry_status: entryRaw.entry_status as 'confirmed' | 'waitlist' | 'offered',
        offer_expires_at: entryRaw.offer_expires_at as string | null,
        created_at: entryRaw.created_at as string,
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
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website'
  const shareUrl = `${baseUrl}/t/${params.id}`

  const CATEGORY_LABELS: Record<string, string> = {
    livre: 'Livre', masculino: 'Masculino', feminino: 'Feminino', misto: 'Misto',
  }
  const SPORT_LABELS: Record<string, string> = {
    beach_tennis: '🎾 Beach Tennis', beach_volei: '🏐 Beach Vôlei', padel: '🏓 Padel',
  }
  const STATUS_LABELS: Record<string, string> = {
    open: 'Inscrições Abertas', in_progress: 'Em Andamento', finished: 'Encerrado',
  }

  return (
    <div className="min-h-screen bg-surface" style={{ maxWidth: 480, margin: '0 auto', fontFamily: 'sans-serif' }}>

      {/* Cover Image */}
      <div
        className="relative w-full"
        style={{ height: 160, background: t.cover_image_url ? undefined : 'linear-gradient(135deg,#1e3a5f 0%,#f97316 100%)' }}
      >
        {t.cover_image_url && (
          <img src={t.cover_image_url} alt={t.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {!t.cover_image_url && (
          <span className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">
            {t.name}
          </span>
        )}
        <ShareButton url={shareUrl} />
      </div>

      {/* Header */}
      <div className="bg-surface-card border-b border-surface-border px-4 py-4">
        {parentEvent && (
          <Link
            href={`/e/${parentEvent.slug}`}
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-400 transition-colors hover:text-brand-300"
          >
            ← {parentEvent.name}
          </Link>
        )}
        <div className="flex flex-wrap gap-2 mb-2.5">
          {t.status !== 'draft' && (
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: isOpen ? '#15803d' : isFinished ? '#334155' : '#92400e', color: '#fff' }}
            >
              {STATUS_LABELS[t.status] ?? t.status}
            </span>
          )}
          <span className="bg-surface-border text-slate-400 text-xs px-2.5 py-1 rounded-full">
            {SPORT_LABELS[t.sport] ?? sportLabel(t.sport)}
          </span>
          {t.category && t.category !== 'livre' && (
            <span className="bg-surface-border text-slate-400 text-xs px-2.5 py-1 rounded-full">
              {CATEGORY_LABELS[t.category] ?? t.category}
            </span>
          )}
        </div>
        <h1 className="text-white text-2xl font-extrabold leading-tight mb-1">{t.name}</h1>
        <p className="text-slate-500 text-sm">
          {formatDate(t.date, "dd 'de' MMMM 'de' yyyy")}
        </p>
      </div>

      {/* CTA de inscrição */}
      {isOpen && (
        <div className="mx-3 mt-3 bg-surface-card border border-surface-border rounded-xl p-4 space-y-3">
          {/* Contador de vagas */}
          {t.max_players && (
            <p className="text-slate-400 text-xs text-center">
              {players.length} confirmados / {t.max_players} vagas
            </p>
          )}
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
        </div>
      )}

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

      {/* Inscritos */}
      {players.length > 0 && (
        <div className="px-3 mt-3">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2">
            {players.length} {players.length === 1 ? 'inscrito' : 'inscritos'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {players.slice(0, 8).map((p) => {
              const abbr = p.full_name.split(' ').slice(0, 2).map((n, i) => (i === 0 ? n : n[0] + '.')).join(' ')
              return (
                <span key={p.id} className="bg-surface-card text-slate-400 text-xs px-2.5 py-1 rounded-full border border-surface-border">
                  {abbr}
                </span>
              )
            })}
            {players.length > 8 && (
              <span className="bg-surface-card text-slate-400 text-xs px-2.5 py-1 rounded-full border border-surface-border">
                +{players.length - 8}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Resultado final (só ao encerrar) */}
      {isFinished && (t.winner1_id || t.winner2_id || t.winner3_id) && (
        <div className="px-3 mt-3 pb-4">
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-2">
            🏆 Resultado final
          </p>
          <div className="flex gap-2 items-end">
            {/* 2º lugar */}
            <div className="flex-1 bg-surface-card rounded-xl p-3 text-center border border-surface-border">
              <div className="text-xl mb-1">🥈</div>
              <div className="text-white text-xs font-semibold leading-tight">
                {t.winner2_id ? winnerNames.get(t.winner2_id) ?? '—' : '—'}
              </div>
              <div className="text-slate-500 text-xs">2º lugar</div>
            </div>
            {/* 1º lugar (maior) */}
            <div className="flex-1 bg-surface-card rounded-xl p-4 text-center border-2 border-brand-500">
              <div className="text-2xl mb-1">🥇</div>
              <div className="text-white text-sm font-bold leading-tight">
                {t.winner1_id ? winnerNames.get(t.winner1_id) ?? '—' : '—'}
              </div>
              <div className="text-brand-500 text-xs font-semibold">1º lugar</div>
            </div>
            {/* 3º lugar */}
            <div className="flex-1 bg-surface-card rounded-xl p-3 text-center border border-surface-border">
              <div className="text-xl mb-1">🥉</div>
              <div className="text-white text-xs font-semibold leading-tight">
                {t.winner3_id ? winnerNames.get(t.winner3_id) ?? '—' : '—'}
              </div>
              <div className="text-slate-500 text-xs">3º lugar</div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-4 mt-4 border-t border-surface-border text-center">
        <span className="text-slate-600 text-xs">Powered by ArenaHub</span>
      </div>

    </div>
  )
}
