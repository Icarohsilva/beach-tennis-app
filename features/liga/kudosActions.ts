'use server'
// features/liga/kudosActions.ts
// Elogio entre alunos (spec §Fase 3).
//
// As quatro travas anti-farming acontecem aqui e no banco:
//   1. teto semanal de elogios que pontuam  → kudosEarnsPoints
//   2. um por colega por semana             → índice único liga_kudos_semana_idx
//   3. recíproco na mesma semana não pontua → kudosEarnsPoints
//   4. receber vale mais que dar            → pesos em LigaSettings
//
// Elogio bloqueado pela trava 1 ou 3 ainda é gravado e aparece no mural: o que
// precisa ser contido é a economia de pontos, não o gesto.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { normalizeSportForOrg } from '@/lib/arenas/sports'
import {
  isKudosCategory,
  isoWeekKey,
  kudosEarnsPoints,
  sanitizeKudosMessage,
} from '@/lib/liga/kudos'
import { brtToday } from '@/lib/utils/gridSchedule'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import { awardLigaPoints } from './awardPoints'
import { syncLigaMedals } from './medals'

/**
 * Instante corrente como meio-dia UTC do dia brasileiro.
 *
 * `isoWeekKey` usa o fuso do processo (UTC na Vercel), então passar `new Date()` cru
 * colocaria a madrugada de segunda-feira brasileira na semana seguinte — liberando um
 * segundo elogio para o mesmo colega no domingo à noite. O meio-dia evita que
 * qualquer deslocamento de fuso mude o dia.
 */
function brtNowForWeek(): Date {
  const [y, m, d] = brtToday(new Date()).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

export interface SendKudosInput {
  toStudentId: string
  sport: string
  category: string
  message: string
}

export interface SendKudosResult {
  error?: string
  /** Falso quando o elogio valeu, mas sem ponto (teto ou reciprocidade). */
  earnedPoints?: boolean
}

export async function sendLigaKudos(input: SendKudosInput): Promise<SendKudosResult> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  if (input.toStudentId === user.id) return { error: 'Elogie um colega, não você mesmo.' }
  if (!isKudosCategory(input.category)) return { error: 'Escolha um tipo de elogio.' }

  const message = sanitizeKudosMessage(input.message)
  if (!message) return { error: 'Escreva um recado de pelo menos 3 letras.' }

  const admin = createAdminClient()

  const settings = await getLigaSettings(orgId)
  if (!settings.enabled) return { error: 'A Liga está desligada nesta academia.' }

  const orgSports = await getOrgSports(orgId)
  const sport = normalizeSportForOrg(input.sport, orgSports)
  if (!sport) return { error: 'Escolha uma modalidade válida.' }

  // O destinatário precisa ser da mesma academia.
  const { data: target } = await admin
    .from('memberships')
    .select('user_id')
    .eq('user_id', input.toStudentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!target) return { error: 'Aluno não encontrado nesta academia.' }

  const season = await getOrCreateActiveSeason(orgId)
  if (!season) return { error: 'Não foi possível abrir a temporada.' }

  // Semana em horário de Brasília: na madrugada de segunda em UTC o Brasil ainda é
  // domingo, e as duas datas caem em semanas ISO diferentes — o que liberaria um
  // segundo elogio "da semana que vem" no domingo à noite.
  const isoWeek = isoWeekKey(brtNowForWeek())

  const [{ count: weeklyPaidCount }, { data: reciprocal }] = await Promise.all([
    admin
      .from('liga_kudos')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('from_student_id', user.id)
      .eq('iso_week', isoWeek)
      .eq('earns_points', true),
    admin
      .from('liga_kudos')
      .select('id')
      .eq('organization_id', orgId)
      .eq('from_student_id', input.toStudentId)
      .eq('to_student_id', user.id)
      .eq('iso_week', isoWeek)
      .maybeSingle(),
  ])

  const earnsPoints = kudosEarnsPoints({
    weeklyPaidCount: weeklyPaidCount ?? 0,
    reciprocalSameWeek: !!reciprocal,
    weeklyCap: settings.kudosWeeklyCap,
  })

  const { data: kudos, error: insertErr } = await admin
    .from('liga_kudos')
    .insert({
      organization_id: orgId,
      season_id: season.id,
      sport,
      from_student_id: user.id,
      to_student_id: input.toStudentId,
      category: input.category,
      message,
      iso_week: isoWeek,
      earns_points: earnsPoints,
    })
    .select('id')
    .maybeSingle()

  // 23505 = unique_violation no índice da semana: trava 2, e ela é do banco de
  // propósito — a checagem só na UI cairia com duas abas abertas.
  if (insertErr?.code === '23505') {
    return { error: 'Você já elogiou essa pessoa esta semana. Escolha outro colega.' }
  }
  if (insertErr || !kudos) return { error: 'Erro ao enviar o elogio. Tente de novo.' }

  if (earnsPoints) {
    await awardLigaPoints(admin, {
      orgId,
      seasonId: season.id,
      studentId: input.toStudentId,
      sport,
      points: settings.kudosPointsReceived,
      reason: 'kudos_received',
      sourceId: kudos.id,
      note: message,
      awardedBy: user.id,
    })
    await awardLigaPoints(admin, {
      orgId,
      seasonId: season.id,
      studentId: user.id,
      sport,
      points: settings.kudosPointsGiven,
      reason: 'kudos_given',
      sourceId: kudos.id,
      awardedBy: user.id,
    })
  }

  // Medalhas de elogio dado/recebido, para os dois lados.
  await Promise.all([
    syncLigaMedals(admin, orgId, user.id),
    syncLigaMedals(admin, orgId, input.toStudentId),
  ])

  revalidatePath('/liga')
  return { earnedPoints: earnsPoints }
}
