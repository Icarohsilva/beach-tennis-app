// lib/liga/medals.ts
// Catálogo de medalhas da Liga (spec §Fase 2).
//
// Medalha é REGRA, não dado: o catálogo mora em código e a tabela liga_medals guarda
// só o que foi conquistado. Acrescentar medalha é deploy, não migration — e a passada
// seguinte do cron concede retroativamente a quem já cumpria o critério.
//
// Nenhuma medalha dá ponto. Se desse, cada medalha nova mexeria no ranking de quem já
// jogou, e o catálogo viraria uma alavanca de inflação.
import { DIVISION_ORDER, type Division } from './divisions'

/** Tudo que o catálogo consegue perguntar sobre um aluno. */
export interface MedalStats {
  /** Presenças no esporte da medalha; nas globais, o total na academia. */
  attendanceCount: number
  /** Semanas seguidas treinando naquele esporte. */
  streakWeeks: number
  tournamentEntries: number
  tournamentWins: number
  division: Division
  /** Meses desde que entrou na academia. */
  monthsSinceJoined: number
  /** Aulas que começam antes das 07:00. */
  earlyClassCount: number
  /** Elogios enviados a colegas (Fase 3). */
  kudosGiven: number
  /** Elogios recebidos de colegas (Fase 3). */
  kudosReceived: number
}

export type MedalScope = 'sport' | 'global'

export interface MedalDef {
  key: string
  label: string
  description: string
  /** Nome do ícone lucide; o mapa de renderização vive no componente. */
  icon: string
  scope: MedalScope
  check: (s: MedalStats) => boolean
}

/** A divisão alcançada é pelo menos esta? Compara pelo índice da escada, não pela string. */
function atLeastDivision(division: Division, floor: Division): boolean {
  return DIVISION_ORDER.indexOf(division) >= DIVISION_ORDER.indexOf(floor)
}

/** Catálogo. Cada medalha só olha dado que já existe. */
export const MEDALS: MedalDef[] = [
  // --- Frequência (por esporte) ---------------------------------------------
  {
    key: 'aulas_10',
    label: 'Pegando o ritmo',
    description: '10 aulas nesta modalidade',
    icon: 'Medal',
    scope: 'sport',
    check: (s) => s.attendanceCount >= 10,
  },
  {
    key: 'aulas_50',
    label: 'Presença constante',
    description: '50 aulas nesta modalidade',
    icon: 'Medal',
    scope: 'sport',
    check: (s) => s.attendanceCount >= 50,
  },
  {
    key: 'aulas_100',
    label: 'Century',
    description: '100 aulas nesta modalidade',
    icon: 'Award',
    scope: 'sport',
    check: (s) => s.attendanceCount >= 100,
  },
  {
    key: 'aulas_250',
    label: 'Parte da quadra',
    description: '250 aulas nesta modalidade',
    icon: 'Award',
    scope: 'sport',
    check: (s) => s.attendanceCount >= 250,
  },

  // --- Sequência (por esporte) ----------------------------------------------
  {
    key: 'streak_4',
    label: 'Um mês sem falhar',
    description: '4 semanas seguidas treinando',
    icon: 'Flame',
    scope: 'sport',
    check: (s) => s.streakWeeks >= 4,
  },
  {
    key: 'streak_8',
    label: 'Dois meses seguidos',
    description: '8 semanas seguidas treinando',
    icon: 'Flame',
    scope: 'sport',
    check: (s) => s.streakWeeks >= 8,
  },
  {
    key: 'streak_12',
    label: 'Um trimestre inteiro',
    description: '12 semanas seguidas treinando',
    icon: 'Flame',
    scope: 'sport',
    check: (s) => s.streakWeeks >= 12,
  },
  {
    key: 'streak_24',
    label: 'Meio ano de constância',
    description: '24 semanas seguidas treinando',
    icon: 'Flame',
    scope: 'sport',
    check: (s) => s.streakWeeks >= 24,
  },

  // --- Torneio (por esporte) ------------------------------------------------
  {
    key: 'torneio_primeiro',
    label: 'Entrou na disputa',
    description: 'Participou do primeiro torneio',
    icon: 'Trophy',
    scope: 'sport',
    check: (s) => s.tournamentEntries >= 1,
  },
  {
    key: 'torneio_vitoria',
    label: 'Campeão',
    description: 'Venceu um torneio',
    icon: 'Trophy',
    scope: 'sport',
    check: (s) => s.tournamentWins >= 1,
  },

  // --- Divisão (por esporte) ------------------------------------------------
  {
    key: 'divisao_ouro',
    label: 'Chegou ao Ouro',
    description: 'Alcançou a divisão Ouro',
    icon: 'Shield',
    scope: 'sport',
    check: (s) => atLeastDivision(s.division, 'ouro'),
  },
  {
    key: 'divisao_diamante',
    label: 'Chegou ao Diamante',
    description: 'Alcançou a divisão Diamante',
    icon: 'Gem',
    scope: 'sport',
    check: (s) => atLeastDivision(s.division, 'diamante'),
  },

  // --- Hábito (por esporte) -------------------------------------------------
  {
    key: 'madrugador',
    label: 'Madrugador',
    description: '10 aulas que começam antes das 07:00',
    icon: 'Sunrise',
    scope: 'sport',
    check: (s) => s.earlyClassCount >= 10,
  },

  // --- Tempo de casa (global) -----------------------------------------------
  {
    key: 'casa_6m',
    label: 'Meio ano de casa',
    description: '6 meses na academia',
    icon: 'Star',
    scope: 'global',
    check: (s) => s.monthsSinceJoined >= 6,
  },
  {
    key: 'casa_12m',
    label: 'Um ano de casa',
    description: '12 meses na academia',
    icon: 'Star',
    scope: 'global',
    check: (s) => s.monthsSinceJoined >= 12,
  },
  {
    key: 'casa_24m',
    label: 'Dois anos de casa',
    description: '24 meses na academia',
    icon: 'Star',
    scope: 'global',
    check: (s) => s.monthsSinceJoined >= 24,
  },

  // --- Convivência (global) -------------------------------------------------
  // Recebidos antes de dados na ordem do catálogo: a vitrine mostra as primeiras
  // como "próximas", e o objetivo que queremos plantar é SER elogiável.
  {
    key: 'elogios_recebidos_10',
    label: 'Reconhecido',
    description: '10 elogios recebidos dos colegas',
    icon: 'Heart',
    scope: 'global',
    check: (s) => s.kudosReceived >= 10,
  },
  {
    key: 'elogios_recebidos_50',
    label: 'Querido da quadra',
    description: '50 elogios recebidos dos colegas',
    icon: 'Heart',
    scope: 'global',
    check: (s) => s.kudosReceived >= 50,
  },
  {
    key: 'elogios_dados_10',
    label: 'Bom de time',
    description: '10 elogios enviados a colegas',
    icon: 'HandHeart',
    scope: 'global',
    check: (s) => s.kudosGiven >= 10,
  },
  {
    key: 'elogios_dados_50',
    label: 'Torcida oficial',
    description: '50 elogios enviados a colegas',
    icon: 'HandHeart',
    scope: 'global',
    check: (s) => s.kudosGiven >= 50,
  },
]

export const MEDAL_BY_KEY = new Map<string, MedalDef>(MEDALS.map((m) => [m.key, m]))

/** Chaves das medalhas daquele escopo que o aluno cumpre com estes números. */
export function evaluateMedals(stats: MedalStats, scope: MedalScope): string[] {
  return MEDALS.filter((m) => m.scope === scope && m.check(stats)).map((m) => m.key)
}

/** Medalhas do catálogo naquele escopo, na ordem de exibição. */
export function medalsForScope(scope: MedalScope): MedalDef[] {
  return MEDALS.filter((m) => m.scope === scope)
}
