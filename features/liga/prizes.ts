// features/liga/prizes.ts
// Premiação da temporada: o que a academia promete e quem ganhou.
import { createAdminClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { sportLabel } from '@/lib/arenas/sports'
import { DIVISION_ORDER, type Division } from '@/lib/liga/divisions'
import type { LigaPrize, LigaPrizeAward } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface PrizeStanding {
  student_id: string
  sport: string
  division: Division
  points: number
}

export interface PromotionMove {
  studentId: string
  sport: string
  from: Division
  to: Division
}

export interface PrizeAwardResult {
  awarded: number
  creditedClasses: number
}

/** Prêmios cadastrados para uma temporada. */
export async function getSeasonPrizes(
  admin: AdminClient,
  seasonId: string,
): Promise<LigaPrize[]> {
  const { data } = await admin
    .from('liga_prizes')
    .select('*')
    .eq('season_id', seasonId)
    .order('kind')
    .order('position', { nullsFirst: false })

  return (data ?? []) as LigaPrize[]
}

/**
 * Apura os ganhadores da temporada que está fechando.
 *
 * Roda ANTES de a temporada virar, porque depende dos standings finais dela e da
 * lista de promovidos que o fechamento acabou de calcular.
 *
 * Idempotente: o índice único (temporada, aluno, modalidade, tipo) faz a segunda
 * execução do cron não duplicar prêmio nem crédito.
 */
export async function awardSeasonPrizes(
  admin: AdminClient,
  input: {
    orgId: string
    seasonId: string
    standings: PrizeStanding[]
    promotions: PromotionMove[]
  },
): Promise<PrizeAwardResult> {
  const prizes = await getSeasonPrizes(admin, input.seasonId)
  if (prizes.length === 0) return { awarded: 0, creditedClasses: 0 }

  const byPosition = new Map<number, LigaPrize>()
  let promotedPrize: LigaPrize | null = null
  for (const prize of prizes) {
    if (prize.kind === 'leader' && prize.position) byPosition.set(prize.position, prize)
    if (prize.kind === 'promoted') promotedPrize = prize
  }

  interface PendingAward {
    studentId: string
    sport: string
    kind: 'leader' | 'promoted'
    position: number | null
    description: string
    creditClasses: number
  }
  const pending: PendingAward[] = []

  // Líderes: a colocação é dentro da modalidade, não da divisão. O prêmio é da
  // temporada inteira — quem lidera o Beach Tennis lidera contra todo mundo que
  // jogou Beach Tennis, não só contra a própria divisão.
  const bySport = new Map<string, PrizeStanding[]>()
  for (const row of input.standings) {
    const list = bySport.get(row.sport) ?? []
    list.push(row)
    bySport.set(row.sport, list)
  }

  for (const [sport, rows] of Array.from(bySport.entries())) {
    rows.sort((a, b) => b.points - a.points || a.student_id.localeCompare(b.student_id))
    rows.forEach((row, index) => {
      const prize = byPosition.get(index + 1)
      // Zero ponto não ganha prêmio, mesmo sozinho na modalidade: premiar quem não
      // jogou queima o prêmio na frente de quem jogou.
      if (!prize || row.points <= 0) return
      pending.push({
        studentId: row.student_id,
        sport,
        kind: 'leader',
        position: index + 1,
        description: prize.description,
        creditClasses: prize.credit_classes,
      })
    })
  }

  // Promovidos: só quem subiu de verdade (o fechamento também devolve descidas).
  if (promotedPrize) {
    for (const move of input.promotions) {
      const subiu = DIVISION_ORDER.indexOf(move.to) > DIVISION_ORDER.indexOf(move.from)
      if (!subiu) continue
      pending.push({
        studentId: move.studentId,
        sport: move.sport,
        kind: 'promoted',
        position: null,
        description: promotedPrize.description,
        creditClasses: promotedPrize.credit_classes,
      })
    }
  }

  if (pending.length === 0) return { awarded: 0, creditedClasses: 0 }

  // ignoreDuplicates: quem já foi premiado nesta temporada não recebe de novo, e o
  // insert dos demais não é perdido junto.
  const { data: inserted } = await admin
    .from('liga_prize_awards')
    .upsert(
      pending.map((p) => ({
        organization_id: input.orgId,
        season_id: input.seasonId,
        student_id: p.studentId,
        sport: p.sport,
        kind: p.kind,
        position: p.position,
        description: p.description,
        credit_classes: p.creditClasses,
      })),
      { onConflict: 'season_id,student_id,sport,kind', ignoreDuplicates: true },
    )
    .select('id, student_id, sport, kind, position, description, credit_classes')

  const novos = (inserted ?? []) as {
    student_id: string
    sport: string
    kind: string
    position: number | null
    description: string
    credit_classes: number
  }[]

  let creditedClasses = 0

  for (const award of novos) {
    if (award.credit_classes > 0) {
      // Crédito pela RPC de sempre: é ela que mantém extrato e saldo juntos.
      const { error } = await admin.rpc('adjust_credits', {
        p_student_id: award.student_id,
        p_org: input.orgId,
        p_delta: award.credit_classes,
        p_type: 'purchased',
        p_reason: `Prêmio da Liga: ${award.description}`,
      })
      if (error) {
        console.error('[liga] crédito de prêmio falhou', {
          studentId: award.student_id,
          error: error.message,
        })
      } else {
        creditedClasses += award.credit_classes
      }
    }

    const titulo =
      award.kind === 'leader'
        ? `Você foi ${award.position}º na Liga de ${sportLabel(award.sport)}`
        : `Você subiu de divisão na Liga de ${sportLabel(award.sport)}`

    const corpo =
      award.credit_classes > 0
        ? `${award.description}. ${award.credit_classes} ${award.credit_classes === 1 ? 'aula creditada' : 'aulas creditadas'} na sua carteira.`
        : `${award.description}. Fale com a academia para receber.`

    try {
      await notifyUsers(admin, {
        orgId: input.orgId,
        recipients: [{ userId: award.student_id }],
        type: 'liga_prize',
        title: titulo,
        body: corpo,
        channels: ['inapp', 'push'],
      })
    } catch (err) {
      // Avisar é importante, mas não pode desfazer o prêmio já gravado.
      console.error('[liga] notificação de prêmio falhou', {
        studentId: award.student_id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { awarded: novos.length, creditedClasses }
}

/** Ganhadores de uma temporada, com o nome do aluno resolvido. */
export async function getSeasonAwards(
  admin: AdminClient,
  seasonId: string,
): Promise<(LigaPrizeAward & { studentName: string })[]> {
  const { data } = await admin
    .from('liga_prize_awards')
    .select('*')
    .eq('season_id', seasonId)
    .order('kind')
    .order('position', { nullsFirst: false })

  const awards = (data ?? []) as LigaPrizeAward[]
  if (awards.length === 0) return []

  const ids = Array.from(new Set(awards.map((a) => a.student_id)))
  const { data: profiles } = await admin.from('profiles').select('id, full_name').in('id', ids)
  const nameById = new Map(
    ((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
  )

  return awards.map((a) => ({ ...a, studentName: nameById.get(a.student_id) ?? 'Aluno' }))
}
