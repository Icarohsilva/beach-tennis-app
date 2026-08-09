// lib/torneios/sportProfile.ts
// Como um torneio se apresenta em cada modalidade.
//
// O motor de torneios já é genérico (`sport` é coluna desde
// `20260626000500_tournaments_generalize.sql`), mas a UI ainda falava só beach
// tennis: chamava todo mundo de "dupla", carimbava "Super 8" em qualquer
// formato e exibia "Nível A/B/C/D" para academia de crossfit, onde a escala de
// letras não quer dizer nada. Este módulo é a camada de vocabulário: dado o
// esporte, diz como chamar quem disputa, como nomear o nível e que cor usar.
//
// É puro — não conhece banco nem React — e cobre as 15 modalidades de
// `lib/arenas/sports.ts` mais as entradas `custom:` de texto livre.
import { SPORT_BY_SLUG, isCustomSport, sportEmoji, sportLabel } from '@/lib/arenas/sports'
import type { ParticipantType, StudentLevel, TournamentFormat } from '@/types'

/** Como o esporte chama quem entra na chave. */
export type CompetitorUnit = 'atleta' | 'dupla' | 'time'

/**
 * Famílias que compartilham vocabulário. A divisão não é taxonômica, é de
 * interface: o que muda é como se nomeia o competidor e a escala de nível.
 */
export type SportFamily = 'raquete' | 'coletivo' | 'individual'

/**
 * Cor da modalidade — só a chave, nunca a classe.
 *
 * As classes do Tailwind moram em `features/torneios/sportTone.ts` porque o
 * `content` do tailwind.config.ts varre app/, components/ e features/, mas não
 * lib/ — uma classe escrita aqui simplesmente não entraria no CSS final, e a
 * pastilha sairia sem cor. `lib/` segue sendo lógica pura.
 */
export type SportTone =
  | 'amber' | 'emerald' | 'lime' | 'cyan' | 'green' | 'teal' | 'red' | 'orange'
  | 'violet' | 'purple' | 'rose' | 'blue' | 'indigo' | 'yellow' | 'pink' | 'slate'

interface SportProfile {
  family: SportFamily
  tone: SportTone
}

const PROFILES: Record<string, SportProfile> = {
  beach_tennis: { family: 'raquete',    tone: 'amber' },
  padel:        { family: 'raquete',    tone: 'emerald' },
  futevolei:    { family: 'raquete',    tone: 'lime' },
  volei_praia:  { family: 'raquete',    tone: 'cyan' },
  tenis:        { family: 'raquete',    tone: 'green' },
  volei_quadra: { family: 'raquete',    tone: 'indigo' },
  futebol:      { family: 'coletivo',   tone: 'teal' },
  basquete:     { family: 'coletivo',   tone: 'yellow' },
  crossfit:     { family: 'individual', tone: 'red' },
  funcional:    { family: 'individual', tone: 'orange' },
  muay_thai:    { family: 'individual', tone: 'rose' },
  natacao:      { family: 'individual', tone: 'blue' },
  pilates:      { family: 'individual', tone: 'violet' },
  yoga:         { family: 'individual', tone: 'purple' },
  danca:        { family: 'individual', tone: 'pink' },
}

// Modalidade fora do cardápio (slug novo, entrada `custom:`) não pode quebrar a
// página: cai no perfil neutro e segue exibível.
const FALLBACK: SportProfile = { family: 'individual', tone: 'slate' }

function profileOf(sport: string | null | undefined): SportProfile {
  if (!sport || isCustomSport(sport)) return FALLBACK
  return PROFILES[sport] ?? FALLBACK
}

export function sportFamily(sport: string | null | undefined): SportFamily {
  return profileOf(sport).family
}

export function sportTone(sport: string | null | undefined): SportTone {
  return profileOf(sport).tone
}

/** Rótulo, emoji e cor para a pastilha do card. */
export function sportChip(sport: string | null | undefined): {
  label: string
  emoji: string
  tone: SportTone
} {
  const slug = sport ?? ''
  return {
    label: slug ? sportLabel(slug) : 'Modalidade',
    emoji: slug ? sportEmoji(slug) : '🏅',
    tone: sportTone(slug),
  }
}

/** Só reporta true para slug do cardápio — usado para não oferecer aba morta. */
export function isKnownSport(sport: string): boolean {
  return SPORT_BY_SLUG.has(sport) || isCustomSport(sport)
}

// --- Quem disputa -----------------------------------------------------------

/**
 * A unidade que ocupa UMA vaga da chave — é o que `max_players` conta.
 *
 * Só a dupla fixa se inscreve junta (uma linha em `tournament_entries` com
 * `partner_id`); no revezando cada atleta entra sozinho e as duplas são
 * sorteadas a cada rodada, então oito inscritos são oito atletas, não oito
 * duplas. Esporte coletivo é sempre time, mesmo com inscrição individual — o
 * aluno se inscreve, o time é montado depois.
 */
export function competitorUnit(
  sport: string | null | undefined,
  participantType: ParticipantType | null | undefined,
): CompetitorUnit {
  if (sportFamily(sport) === 'coletivo') return 'time'
  return participantType === 'dupla_fixa' ? 'dupla' : 'atleta'
}

const UNIT_WORDS: Record<CompetitorUnit, { one: string; many: string }> = {
  atleta: { one: 'atleta', many: 'atletas' },
  dupla:  { one: 'dupla',  many: 'duplas' },
  time:   { one: 'time',   many: 'times' },
}

/** "1 dupla" / "8 duplas" / "12 atletas", conforme a modalidade. */
export function competitorCountLabel(
  count: number,
  sport: string | null | undefined,
  participantType: ParticipantType | null | undefined,
): string {
  const words = UNIT_WORDS[competitorUnit(sport, participantType)]
  return `${count} ${count === 1 ? words.one : words.many}`
}

/** Substantivo isolado, para frases montadas na UI ("Vagas por dupla"). */
export function competitorNoun(
  sport: string | null | undefined,
  participantType: ParticipantType | null | undefined,
  plural = false,
): string {
  const words = UNIT_WORDS[competitorUnit(sport, participantType)]
  return plural ? words.many : words.one
}

/**
 * Como o torneio forma os pares. Descreve a dinâmica, não a unidade de vaga:
 * "Dupla sorteada" aparece mesmo no revezando, onde a inscrição é individual —
 * é justamente isso que o aluno precisa saber antes de entrar.
 */
export function participantLabel(
  sport: string | null | undefined,
  participantType: ParticipantType | null | undefined,
): string | null {
  if (sportFamily(sport) === 'coletivo') return null
  if (participantType === 'dupla_fixa') return 'Dupla fixa'
  if (participantType === 'dupla_revezando') return 'Dupla sorteada'
  return null
}

// --- Nível ------------------------------------------------------------------

// Esporte de raquete no Brasil usa a escala de letras da CBT, e o aluno a
// reconhece de cara. Fora dela, "Nível C" não informa nada — vira palavra.
const LEVEL_RAQUETE: Record<StudentLevel, string> = {
  iniciante: 'Iniciante',
  D: 'Nível D',
  C: 'Nível C',
  B: 'Nível B',
  A: 'Nível A',
}

const LEVEL_GERAL: Record<StudentLevel, string> = {
  iniciante: 'Iniciante',
  D: 'Básico',
  C: 'Intermediário',
  B: 'Avançado',
  A: 'Elite',
}

/** Ordem do mais aberto ao mais forte. É a ordem em que os filtros aparecem. */
export const LEVEL_ORDER: StudentLevel[] = ['iniciante', 'D', 'C', 'B', 'A']

export function levelLabel(level: StudentLevel, sport: string | null | undefined): string {
  const table = sportFamily(sport) === 'raquete' ? LEVEL_RAQUETE : LEVEL_GERAL
  return table[level] ?? String(level)
}

// --- Formato ----------------------------------------------------------------

const FORMAT_LABELS: Record<TournamentFormat, string> = {
  americano: 'Americano',
  round_robin: 'Todos contra todos',
  eliminatoria: 'Eliminatória',
  grupos: 'Grupos + mata-mata',
  ranking: 'Ranking',
  super8: 'Super 8', // legado: linhas anteriores ao motor genérico
}

/**
 * Nome do formato como o card mostra.
 *
 * No americano com teto de vagas o mercado não diz "americano", diz "Super 8",
 * "Super 12", "Super 16" — o número de participantes É o nome do torneio. Sem
 * teto definido, cai no nome do formato. Antes daqui o card carimbava "Super 8"
 * fixo em todo torneio, inclusive nos de 20 vagas.
 */
export function formatLabel(
  format: TournamentFormat | null | undefined,
  maxPlayers?: number | null,
): string {
  const fmt = (format ?? 'americano') as TournamentFormat
  if ((fmt === 'americano' || fmt === 'super8') && maxPlayers && maxPlayers > 0) {
    return `Super ${maxPlayers}`
  }
  return FORMAT_LABELS[fmt] ?? 'Americano'
}

// --- Categoria --------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  masculino: 'Masculino',
  feminino: 'Feminino',
  misto: 'Misto',
  livre: 'Livre',
}

export function categoryLabel(category: string | null | undefined): string | null {
  if (!category) return null
  return CATEGORY_LABELS[category] ?? null
}
