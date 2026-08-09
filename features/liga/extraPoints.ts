// features/liga/extraPoints.ts
// Fontes extras de ponto: comportamento que ajuda a academia.
//
// Todas passam por um caminho só porque o contrato é o mesmo: best-effort, nunca
// derruba a operação de origem (agendar, cancelar, confirmar presença) e nunca lança.
// A Liga falhando não pode impedir um aluno de cancelar uma aula.
import { createAdminClient } from '@/lib/supabase/server'
import { getOrgSports } from '@/lib/arenas/orgSports'
import type { LigaWeights } from '@/lib/liga/points'
import type { LigaPointReason } from '@/types'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import { awardLigaPoints } from './awardPoints'

type AdminClient = ReturnType<typeof createAdminClient>

/** Fontes extras e o peso que cada uma lê. */
const WEIGHT_KEY: Record<string, keyof LigaWeights> = {
  self_checkin: 'selfCheckin',
  cancel_in_time: 'cancelInTime',
  waitlist_accept: 'waitlistAccept',
  early_booking: 'earlyBooking',
  profile_complete: 'profileComplete',
  dayuse: 'dayUse',
}

export type ExtraReason = keyof typeof WEIGHT_KEY & LigaPointReason

/**
 * Modalidade que recebe um ponto sem esporte próprio (day use, perfil completo).
 *
 * Usa o primeiro esporte declarado pelo aluno; se ele não declarou nenhum, cai na
 * modalidade única da academia. Sem nenhum dos dois, não pontua — mesma escolha
 * conservadora de `sportForAttendance`: chutar um ranking seria pior que não pontuar.
 */
async function resolvePrimarySport(
  admin: AdminClient,
  orgId: string,
  studentId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('memberships')
    .select('sports')
    .eq('organization_id', orgId)
    .eq('user_id', studentId)
    .maybeSingle()

  const sports = ((data as { sports: string[] } | null)?.sports ?? []).filter(Boolean)
  if (sports.length > 0) return sports[0]

  const orgSports = await getOrgSports(orgId)
  return orgSports.length === 1 ? orgSports[0] : null
}

export interface ExtraPointInput {
  orgId: string
  studentId: string
  reason: ExtraReason
  /** Evento de origem; é ele que torna o crédito idempotente. */
  sourceId?: string | null
  /** Modalidade, quando o evento tem uma. Sem isto, cai no esporte principal do aluno. */
  sport?: string | null
  note?: string | null
}

/**
 * Credita uma fonte extra. Nunca lança.
 *
 * Peso zero significa fonte desligada pela academia, e nesse caso nem chega a abrir
 * temporada — o caminho todo sai barato quando a academia não quer aquela fonte.
 */
export async function awardLigaExtra(
  admin: AdminClient,
  input: ExtraPointInput,
): Promise<void> {
  try {
    const settings = await getLigaSettings(input.orgId)
    if (!settings.enabled) return

    const points = settings.weights[WEIGHT_KEY[input.reason]]
    if (!points || points <= 0) return

    const sport =
      input.sport ?? (await resolvePrimarySport(admin, input.orgId, input.studentId))
    if (!sport) return

    const season = await getOrCreateActiveSeason(input.orgId)
    if (!season) return

    await awardLigaPoints(admin, {
      orgId: input.orgId,
      seasonId: season.id,
      studentId: input.studentId,
      sport,
      points,
      reason: input.reason,
      sourceId: input.sourceId ?? null,
      note: input.note ?? null,
    })
  } catch (err) {
    console.error('[liga] awardLigaExtra falhou', {
      reason: input.reason,
      studentId: input.studentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Ponto de cadastro completo. Uma vez na vida, não uma por temporada.
 *
 * O índice de deduplicação do extrato é por temporada, então sem esta checagem o
 * aluno ganharia o bônus de novo todo mês só por ter o cadastro preenchido.
 */
export async function awardProfileCompleteOnce(
  admin: AdminClient,
  orgId: string,
  studentId: string,
): Promise<void> {
  try {
    const { count } = await admin
      .from('liga_points')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('student_id', studentId)
      .eq('reason', 'profile_complete')

    if ((count ?? 0) > 0) return

    await awardLigaExtra(admin, {
      orgId,
      studentId,
      reason: 'profile_complete',
      note: 'Cadastro completo',
    })
  } catch (err) {
    console.error('[liga] awardProfileCompleteOnce falhou', {
      studentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Confere se o cadastro está completo e, se estiver, credita o bônus único.
 *
 * "Completo" é o mínimo que a academia precisa para operar: telefone para chamar,
 * contato de emergência para o caso de acidente na quadra, e ao menos uma modalidade
 * (sem ela o aluno não entra em ranking nenhum). Nada de exigir foto ou endereço, que
 * a academia não usa — a régua tem que ser o que dói na operação.
 */
export async function checkProfileComplete(
  admin: AdminClient,
  orgId: string,
  studentId: string,
): Promise<void> {
  try {
    const [{ data: profile }, { data: medical }, { data: membership }] = await Promise.all([
      admin.from('profiles').select('phone').eq('id', studentId).maybeSingle(),
      admin
        .from('medical_profiles')
        .select('emergency_name, emergency_phone')
        .eq('profile_id', studentId)
        .maybeSingle(),
      admin
        .from('memberships')
        .select('sports')
        .eq('organization_id', orgId)
        .eq('user_id', studentId)
        .maybeSingle(),
    ])

    const temTelefone = !!(profile as { phone: string | null } | null)?.phone?.trim()
    const emergencia = medical as { emergency_name: string | null; emergency_phone: string | null } | null
    const temEmergencia = !!emergencia?.emergency_name?.trim() && !!emergencia?.emergency_phone?.trim()
    const temEsporte = (((membership as { sports: string[] } | null)?.sports ?? []).length > 0)

    if (!temTelefone || !temEmergencia || !temEsporte) return

    await awardProfileCompleteOnce(admin, orgId, studentId)
  } catch (err) {
    console.error('[liga] checkProfileComplete falhou', {
      studentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
