// lib/torneios/shirt.ts
// Tamanho de camisa do inscrito. Puro, sem I/O.
//
// O catálogo vive em CÓDIGO, e não em tabela — mesma escolha de
// `lib/liga/medals.ts`. Acrescentar tamanho é deploy, de propósito: a grade é a
// que a confecção entrega, muda uma vez por ano e não é configuração de
// academia. Em tabela, cada arena inventaria a sua e a planilha de encomenda
// deixaria de somar entre torneios.

// O tipo mora em types/index.ts junto do schema (mesmo arranjo de ScoringMode);
// a GRADE e as regras moram aqui.
import type { ShirtSize } from '@/types'

export type { ShirtSize }

/**
 * Ordem da grade, e não alfabética: é a ordem em que a tela mostra as opções e
 * em que a planilha soma. Tradicional primeiro, baby look depois — é como a
 * encomenda é fechada com o fornecedor.
 */
export const SHIRT_SIZES: readonly ShirtSize[] = [
  'p', 'm', 'g', 'gg', 'xg',
  'baby_p', 'baby_m', 'baby_g', 'baby_gg',
]

export const SHIRT_SIZE_LABEL: Record<ShirtSize, string> = {
  p: 'P',
  m: 'M',
  g: 'G',
  gg: 'GG',
  xg: 'XG',
  baby_p: 'Baby look P',
  baby_m: 'Baby look M',
  baby_g: 'Baby look G',
  baby_gg: 'Baby look GG',
}

/** O corte da peça — o que separa duas encomendas diferentes na confecção. */
export type ShirtCut = 'tradicional' | 'baby_look'

export function shirtCut(size: ShirtSize): ShirtCut {
  return size.startsWith('baby_') ? 'baby_look' : 'tradicional'
}

export const SHIRT_CUT_LABEL: Record<ShirtCut, string> = {
  tradicional: 'Tradicional',
  baby_look: 'Baby look',
}

/**
 * Valida o que veio de um `<select>` ou de uma linha do banco.
 *
 * Devolve `null` em vez de lançar: tamanho inválido é dado de formulário, e a
 * action decide se recusa (inscrição nova) ou ignora (linha antiga sem valor).
 */
export function parseShirtSize(value: unknown): ShirtSize | null {
  return typeof value === 'string' && (SHIRT_SIZES as readonly string[]).includes(value)
    ? (value as ShirtSize)
    : null
}

export function shirtSizeLabel(size: ShirtSize | null | undefined): string {
  return size ? SHIRT_SIZE_LABEL[size] : '—'
}

/**
 * O tamanho informado serve para este torneio?
 *
 * Um lugar só porque SEIS caminhos de inscrição precisam concordar — aluno
 * logado, avulso do link público, conta criada na hora, parceiro aceitando
 * convite, admin inscrevendo e promoção da fila. Um deles que não validasse
 * deixaria entrar sem tamanho justamente no torneio que existe para ter a
 * planilha.
 */
export function validateShirtSize(
  value: unknown,
  opts: { required: boolean; who?: string },
): { ok: true; size: ShirtSize | null } | { ok: false; error: string } {
  const size = parseShirtSize(value)
  if (size) return { ok: true, size }
  if (!opts.required) return { ok: true, size: null }
  const quem = opts.who ? ` de ${opts.who}` : ''
  return { ok: false, error: `Escolha o tamanho da camisa${quem}.` }
}

/**
 * O que ESTE torneio pede na inscrição, já com o teto aplicado.
 *
 * Nome sem camisa não existe, e `shirt_names_enabled` sozinho não pode fazer a
 * tela pedir estampa para um torneio que não dá camisa. Uma função só porque
 * seis caminhos de inscrição e três telas precisam da mesma leitura — cada um
 * combinando os dois booleanos por conta própria é como um deles combina errado.
 */
export function shirtConfig(tournament: {
  shirt_sizes_enabled?: boolean | null
  shirt_names_enabled?: boolean | null
}): { size: boolean; name: boolean } {
  const size = Boolean(tournament.shirt_sizes_enabled)
  return { size, name: size && Boolean(tournament.shirt_names_enabled) }
}

// ---------------------------------------------------------------------------
// Nome estampado
// ---------------------------------------------------------------------------

/**
 * Quantos caracteres cabem nas costas.
 *
 * Não é limite de banco: é largura de estampa. Acima disso a serigrafia reduz a
 * fonte até o nome virar um fio, e quem escolhe o que cortar tem de ser a
 * pessoa — na tela, com o campo na frente —, não o silk na hora de imprimir.
 */
export const MAX_SHIRT_NAME = 16

/**
 * O nome como vai para a estampa: sem espaço sobrando e sem espaço duplo.
 *
 * Não força maiúscula: caixa é decisão da arte, e gravar "ZECA" impediria a
 * arena de imprimir "Zeca" depois. O CSV entrega o que a pessoa digitou.
 */
export function normalizeShirtName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
}

/**
 * Sugestão de nome a partir do cadastro: o PRIMEIRO nome.
 *
 * "José Carlos da Silva Pereira" não cabe nas costas, e deixar o campo vazio
 * faz a pessoa digitar o nome completo do jeito que está no documento. O
 * primeiro nome é o que a turma chama de fato, e ela edita se quiser o apelido.
 */
export function suggestShirtName(fullName: string | null | undefined): string {
  const first = normalizeShirtName(fullName).split(' ')[0] ?? ''
  return first.slice(0, MAX_SHIRT_NAME)
}

export function validateShirtName(
  value: unknown,
  opts: { required: boolean; who?: string },
): { ok: true; name: string | null } | { ok: false; error: string } {
  const name = normalizeShirtName(value)
  if (!name) {
    if (!opts.required) return { ok: true, name: null }
    const quem = opts.who ? ` de ${opts.who}` : ''
    return { ok: false, error: `Informe o nome que vai na camisa${quem}.` }
  }
  if (name.length > MAX_SHIRT_NAME) {
    return {
      ok: false,
      error: `O nome na camisa cabe em ${MAX_SHIRT_NAME} caracteres. `
        + `"${name}" tem ${name.length} — use o primeiro nome ou um apelido.`,
    }
  }
  return { ok: true, name }
}

// ---------------------------------------------------------------------------
// Resumo da encomenda
// ---------------------------------------------------------------------------

export interface ShirtTally {
  size: ShirtSize
  label: string
  count: number
}

export interface ShirtSummary {
  /** Um item por tamanho COM pedido; tamanho zerado não entra. */
  tally: ShirtTally[]
  /** Quantas camisas no total — o número que vai para a confecção. */
  total: number
  /**
   * Quantos inscritos ainda não informaram tamanho. É a pergunta operacional
   * real ("já dá para encomendar?"), e some da lista se ficar implícita.
   */
  missing: number
}

/**
 * Soma por tamanho, na ordem da grade.
 *
 * Existe separado do CSV porque a tela precisa do mesmo número que a planilha:
 * o admin decide encomendar olhando o resumo, e conferir depois numa soma feita
 * por outro caminho é como as duas divergem.
 */
export function summarizeShirtSizes(sizes: (ShirtSize | null | undefined)[]): ShirtSummary {
  const counts = new Map<ShirtSize, number>()
  let missing = 0

  for (const s of sizes) {
    if (!s) { missing++; continue }
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }

  const tally = SHIRT_SIZES
    .filter((s) => (counts.get(s) ?? 0) > 0)
    .map((s) => ({ size: s, label: SHIRT_SIZE_LABEL[s], count: counts.get(s)! }))

  return {
    tally,
    total: tally.reduce((sum, t) => sum + t.count, 0),
    missing,
  }
}

// ---------------------------------------------------------------------------
// Planilha
// ---------------------------------------------------------------------------

/** Uma pessoa na lista de camisas — titular ou parceiro, cada um é uma linha. */
export interface ShirtRow {
  /** Inscrição e lado — é por onde o admin preenche a camisa de quem falta. */
  entryId: string
  side: 'player' | 'partner'
  /** Nome do cadastro, para a arena saber de quem é a camisa. */
  name: string
  size: ShirtSize | null
  /**
   * O que vai ESTAMPADO. Separado do nome do cadastro de propósito: a estampa
   * diz "Zeca" e a lista de conferência precisa dizer "José Carlos" — misturar
   * os dois entrega camisa na mão errada.
   */
  shirtName: string | null
  /** 'confirmed' | 'waitlist' | 'offered' — a arena não encomenda para a fila. */
  entryStatus: string
  phone: string | null
}

function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmado',
  waitlist: 'Lista de espera',
  offered: 'Vaga oferecida',
}

/**
 * CSV para levar à confecção. Separador `;` e BOM porque o público é brasileiro
 * e o Excel pt-BR só abre direito assim (mesma decisão de `tenantsToCsv`).
 *
 * Ordenado por TAMANHO, não por nome: quem recebe a planilha está separando
 * pilhas de camisa, e ordenar por nome obriga a pessoa a reordenar tudo antes
 * de usar. O nome resolve o empate dentro do tamanho.
 */
export function shirtRowsToCsv(rows: ShirtRow[]): string {
  const header = ['Tamanho', 'Corte', 'Nome na camisa', 'Inscrito', 'Situacao', 'Telefone']
  const order = new Map(SHIRT_SIZES.map((s, i) => [s, i]))

  const sorted = [...rows].sort((a, b) => {
    // Sem tamanho vai para o fim: é pendência, não item de encomenda.
    const ia = a.size ? order.get(a.size)! : SHIRT_SIZES.length
    const ib = b.size ? order.get(b.size)! : SHIRT_SIZES.length
    return ia - ib || a.name.localeCompare(b.name, 'pt-BR')
  })

  const lines = sorted.map((r) => [
    r.size ? SHIRT_SIZE_LABEL[r.size] : 'NAO INFORMADO',
    r.size ? SHIRT_CUT_LABEL[shirtCut(r.size)] : '',
    // Vazio, e não o nome do cadastro: torneio de camisa lisa não tem estampa,
    // e preencher aqui faria a serigrafia imprimir o que ninguém pediu.
    r.shirtName ?? '',
    r.name,
    STATUS_LABEL[r.entryStatus] ?? r.entryStatus,
    r.phone ?? '',
  ].map(csvCell).join(';'))

  return '﻿' + [header.join(';'), ...lines].join('\n')
}
