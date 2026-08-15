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
import { awardLigaPoints, revokeLigaPoints } from './awardPoints'

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
 * Desfaz uma fonte extra. Nunca lança. Espelho exato de `awardLigaExtra`.
 *
 * Existe porque entrar e sair de aula é um par, e só o crédito estava
 * implementado: entrar rendia `early_booking`, sair rendia `cancel_in_time`, e
 * nada era revogado — quem entrava e saía somava os dois numa aula que nunca
 * aconteceu, e repetia a manobra em toda sessão. Agora cada lado revoga o do
 * outro, e o extrato de quem entra e sai fica igual ao de quem nunca saiu.
 *
 * A resolução de esporte precisa ser a MESMA do crédito, senão a revogação
 * procura a linha no ranking errado e não acha nada. Por isso `sport` é opcional
 * aqui também: quem creditou sem esporte explícito revoga sem esporte explícito.
 */
export async function revokeLigaExtra(
  admin: AdminClient,
  input: Omit<ExtraPointInput, 'note'>,
): Promise<void> {
  try {
    const settings = await getLigaSettings(input.orgId)
    if (!settings.enabled) return

    const sport =
      input.sport ?? (await resolvePrimarySport(admin, input.orgId, input.studentId))
    if (!sport) return

    const season = await getOrCreateActiveSeason(input.orgId)
    if (!season) return

    await revokeLigaPoints(admin, {
      seasonId: season.id,
      studentId: input.studentId,
      sport,
      reason: input.reason,
      sourceId: input.sourceId ?? null,
    })
  } catch (err) {
    console.error('[liga] revokeLigaExtra falhou', {
      reason: input.reason,
      studentId: input.studentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Pontos que a ENTRADA numa aula credita. Sair da aula revoga os dois: o aluno
 * recebeu um OU outro (ver bookSessionAs), e tentar revogar o que não existe é
 * barato — `liga_revoke_points` não acha linha e não faz nada.
 */
export const ENTRY_REASONS: ExtraReason[] = ['waitlist_accept', 'early_booking']

/**
 * Ponto que a SAÍDA da aula credita. Entrar de novo revoga: senão o ciclo
 * sair→entrar deixaria o prêmio de ter liberado a vaga que o aluno retomou.
 */
export const EXIT_REASON: ExtraReason = 'cancel_in_time'

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
 * "Completo" é o mínimo que a academia precisa para operar: telefone para chamar e
 * contato de emergência para o caso de acidente na quadra. Nada de exigir foto ou
 * endereço, que a academia não usa — a régua tem que ser o que dói na operação.
 *
 * A modalidade é exigida só onde ela é uma escolha de verdade. Numa academia que
 * oferece uma modalidade só, pedir que o aluno a declare é burocracia: não há o que
 * escolher, e o ponto ia para esse mesmo esporte de qualquer jeito. Exigir isso fazia
 * quem preencheu tudo o que a tela pede ficar sem o bônus, sem entender por quê.
 */
export async function checkProfileComplete(
  admin: AdminClient,
  orgId: string,
  studentId: string,
): Promise<void> {
  try {
    const [{ data: profile }, { data: medical }, { data: membership }, orgSports] =
      await Promise.all([
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
        getOrgSports(orgId),
      ])

    const temTelefone = !!(profile as { phone: string | null } | null)?.phone?.trim()
    const emergencia = medical as {
      emergency_name: string | null
      emergency_phone: string | null
    } | null
    const temEmergencia =
      !!emergencia?.emergency_name?.trim() && !!emergencia?.emergency_phone?.trim()

    const declarou = ((membership as { sports: string[] } | null)?.sports ?? []).length > 0
    const temEsporte = declarou || orgSports.length === 1

    if (!temTelefone || !temEmergencia || !temEsporte) return

    await awardProfileCompleteOnce(admin, orgId, studentId)
  } catch (err) {
    console.error('[liga] checkProfileComplete falhou', {
      studentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
