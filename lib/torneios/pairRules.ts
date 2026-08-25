// lib/torneios/pairRules.ts
// Que composições de dupla um torneio aceita, e quem pode se inscrever.
//
// Substitui canRegister() de eligibility.ts: aquela função só via o gênero de
// QUEM CLICOU, nunca o do parceiro — um torneio 'masculino' aceitava dupla
// homem+mulher desde que quem se inscreveu fosse homem. A régua agora mora
// aqui, única, testada, e a migração 20260826000100_tournament_pair_genders.sql
// grava o MESMO mapa (category → allowed_pair_genders) que pairGendersFor()
// devolve — divergir faria a tela oferecer o que o banco recusa.
//
// allowed_pair_genders é lido de duas formas, de propósito:
//   dupla_fixa                    → valida a FORMAÇÃO do par (MM/MF/FF);
//   individual / dupla_revezando  → vale só a UNIÃO das letras ("quem pode
//   entrar"), porque no Super o parceiro é sorteado a cada rodada e prometer
//   "sem dupla masculina" com 5 homens e 3 mulheres é impossível de cumprir.
import type { Gender, TournamentCategory, ParticipantType, PairGenders } from '@/types'

export const ALL_PAIR_GENDERS: readonly PairGenders[] = ['MM', 'MF', 'FF']

export interface RuleVerdict {
  ok: boolean
  reason?: string
}

/** Ordena, dedupa e descarta lixo. É a porta do CHECK do banco. */
export function canonicalizePairGenders(input: readonly string[]): PairGenders[] {
  const set = new Set(input.filter((v): v is PairGenders => ALL_PAIR_GENDERS.includes(v as PairGenders)))
  return ALL_PAIR_GENDERS.filter((g) => set.has(g))
}

/**
 * O MESMO mapa do backfill da migração 20260826000100. Divergir aqui faz a
 * tela prometer o que o banco recusa.
 */
export function pairGendersFor(category: TournamentCategory): PairGenders[] {
  switch (category) {
    case 'masculino':
      return ['MM']
    case 'feminino':
      return ['FF']
    case 'misto':
      return ['MF']
    default:
      return ['MM', 'MF', 'FF']
  }
}

/** Formação de um par. null quando algum gênero é desconhecido. */
export function pairGendersOf(a: Gender | null, b: Gender | null): PairGenders | null {
  if (a === null || b === null) return null
  if (a === 'M' && b === 'M') return 'MM'
  if (a === 'F' && b === 'F') return 'FF'
  return 'MF'
}

/** Quais gêneros podem sequer entrar — a união das letras do conjunto. */
export function gendersAdmitted(allowed: readonly PairGenders[]): { M: boolean; F: boolean } {
  return {
    M: allowed.some((g) => g === 'MM' || g === 'MF'),
    F: allowed.some((g) => g === 'FF' || g === 'MF'),
  }
}

/**
 * Só {MM,MF,FF} dispensa gênero no perfil: com qualquer restrição, gênero
 * nulo é indecidível — não dá para saber, sem saber o gênero, se a pessoa
 * cabe na regra (mesmo que M e F sejam individualmente admitidos por letras
 * diferentes do conjunto, como em {MF,FF}).
 */
export function requiresKnownGender(allowed: readonly PairGenders[]): boolean {
  return canonicalizePairGenders(allowed).length !== ALL_PAIR_GENDERS.length
}

const PROFILE_MESSAGE = 'Complete seu gênero no perfil para se inscrever nesta categoria.'
const PARTNER_PROFILE_MESSAGE =
  'O parceiro precisa completar o gênero no perfil antes de entrar na dupla.'

export function canEnter(gender: Gender | null, allowed: readonly PairGenders[]): RuleVerdict {
  if (gender === null) {
    if (!requiresKnownGender(allowed)) return { ok: true }
    return { ok: false, reason: PROFILE_MESSAGE }
  }
  const admitted = gendersAdmitted(allowed)
  if (gender === 'M' && !admitted.M) return { ok: false, reason: 'Este torneio é exclusivo para feminino.' }
  if (gender === 'F' && !admitted.F) return { ok: false, reason: 'Este torneio é exclusivo para masculino.' }
  return { ok: true }
}

function pairRejectionMessage(allowed: readonly PairGenders[]): string {
  const set = new Set(allowed)
  if (set.size === 1) {
    const only = allowed[0]
    if (only === 'MF') return 'Categoria mista exige uma dupla com 1 homem e 1 mulher.'
    if (only === 'MM') return 'Neste torneio só é permitida dupla masculina (2 homens).'
    return 'Neste torneio só é permitida dupla feminina (2 mulheres).' // only === 'FF'
  }
  if (!set.has('MM')) return 'Neste torneio não é permitida dupla de dois homens.'
  if (!set.has('FF')) return 'Neste torneio não é permitida dupla de duas mulheres.'
  return 'Neste torneio a dupla tem de ser do mesmo gênero.' // falta MF => {MM,FF}
}

export function canPairUp(
  a: Gender | null,
  b: Gender | null,
  allowed: readonly PairGenders[],
): RuleVerdict {
  if (a === null) return { ok: false, reason: PROFILE_MESSAGE }
  if (b === null) return { ok: false, reason: PARTNER_PROFILE_MESSAGE }
  const formation = pairGendersOf(a, b)
  if (formation === null || !allowed.includes(formation)) {
    return { ok: false, reason: pairRejectionMessage(allowed) }
  }
  return { ok: true }
}

/** Veredito único da inscrição: cobre os dois lados e os 3 participant_type. */
export function validateEntry(input: {
  participantType: ParticipantType
  allowed: readonly PairGenders[]
  myGender: Gender | null
  /** undefined = parceiro ainda não informado. */
  partnerGender?: Gender | null
}): RuleVerdict {
  const { participantType, allowed, myGender, partnerGender } = input

  if (participantType !== 'dupla_fixa') {
    return canEnter(myGender, allowed)
  }

  if (partnerGender === undefined) {
    return { ok: false, reason: 'Selecione um parceiro para dupla fixa.' }
  }
  return canPairUp(myGender, partnerGender, allowed)
}

export interface PairPreset {
  allowed: PairGenders[]
  label: string
  hint: string
}

/** Presets nomeados — rótulo sobre o conjunto guardado, nunca o contrário. */
export const PAIR_PRESETS: PairPreset[] = [
  { allowed: ['MM', 'MF', 'FF'], label: 'Qualquer formação', hint: 'Nenhuma restrição de gênero na dupla.' },
  { allowed: ['MM'], label: 'Somente duplas masculinas', hint: 'Os dois integrantes têm de ser homens.' },
  { allowed: ['FF'], label: 'Somente duplas femininas', hint: 'As duas integrantes têm de ser mulheres.' },
  { allowed: ['MF'], label: 'Somente duplas mistas', hint: '1 homem e 1 mulher em cada dupla.' },
  { allowed: ['MF', 'FF'], label: 'Sem dupla masculina', hint: 'Aceita mista ou feminina; não aceita dois homens.' },
  { allowed: ['MM', 'MF'], label: 'Sem dupla feminina', hint: 'Aceita mista ou masculina; não aceita duas mulheres.' },
  { allowed: ['MM', 'FF'], label: 'Somente duplas do mesmo gênero', hint: 'Aceita masculina ou feminina; não aceita mista.' },
]

export function pairGendersLabel(allowed: readonly PairGenders[]): string {
  const canon = canonicalizePairGenders(allowed)
  const preset = PAIR_PRESETS.find(
    (p) => p.allowed.length === canon.length && p.allowed.every((g) => canon.includes(g)),
  )
  return preset?.label ?? 'Formação personalizada'
}

/** Pastilha da página pública. Nulo quando não há nada a avisar. */
export function entryRuleLabel(pt: ParticipantType, allowed: readonly PairGenders[]): string | null {
  if (pt !== 'dupla_fixa') return null
  const canon = canonicalizePairGenders(allowed)
  if (canon.length === ALL_PAIR_GENDERS.length) return null
  return pairGendersLabel(canon)
}
