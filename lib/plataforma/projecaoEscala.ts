// lib/plataforma/projecaoEscala.ts
// "Meu sistema aguenta mil arenas de 300 alunos?" — respondido a partir do que a
// base REAL consome hoje, não de estimativa de guardanapo.
//
// A conta é uma regra de três sobre o número de alunos, com dois cuidados que a
// regra de três ingênua erra:
//
//   1. Nem todo byte escala com aluno. Catálogo do sistema, tabelas de
//      configuração e o próprio overhead do Postgres existem com 1 ou 300 mil
//      alunos. Multiplicar db_bytes inteiro por 750 transformaria 8 MB de
//      catálogo em 6 GB de ficção. Aqui só a parte de dados é escalada; o resto
//      entra como parcela fixa.
//
//   2. Extrapolar de uma base minúscula não vale nada. Com 40 alunos, cada
//      aluno a mais muda o "bytes por aluno" em vários por cento, e o fator de
//      multiplicação amplifica esse ruído. Por isso a projeção se declara não
//      confiável em vez de imprimir um número bonito e errado.
//
// A ressalva que não dá para resolver com matemática: isto assume o MESMO
// histórico por aluno que a base tem hoje. Operação de dois meses tem dois meses
// de presenças acumuladas por aluno; em regime, o mesmo aluno terá anos. Quem
// consome esta projeção precisa ver a idade da base junto — por isso
// `avaliarMaturidade` mora aqui e a página mostra os dois lado a lado.

import { avaliarLimites, type CapacityMetrics, type Limite } from './capacity'

export interface AlvoEscala {
  arenas: number
  alunosPorArena: number
}

/** A pergunta que originou o painel. */
export const ALVO_PADRAO: AlvoEscala = { arenas: 1000, alunosPorArena: 300 }

/** Abaixo disto a extrapolação é ruído multiplicado — não se declara confiável. */
export const ALUNOS_MINIMOS_CONFIAVEL = 200

export interface LinhaProjecao {
  nome: string
  atual: number
  projetado: number
}

export interface ProjecaoEscala {
  alunosAlvo: number
  /** Quantas vezes a base de hoje. */
  fator: number
  confiavel: boolean
  /** Por que não é confiável — null quando é. */
  ressalva: string | null
  /** Parcela que não cresce com aluno (catálogo, configuração, overhead). */
  bytesFixos: number
  dbBytesProjetado: number
  mauProjetado: number
  /** Linhas por tabela, da maior projetada para a menor. */
  tabelas: LinhaProjecao[]
  /** Os mesmos tetos da página, avaliados contra o cenário projetado. */
  limites: Limite[]
}

/**
 * Extrapola as métricas de hoje para o alvo e reavalia os tetos de plano.
 *
 * Reaproveita `avaliarLimites` montando um CapacityMetrics sintético: a regra de
 * "o que é teto e quando ele dói" fica num lugar só, e a projeção não pode
 * divergir da leitura do presente.
 */
export function projetarEscala(m: CapacityMetrics, alvo: AlvoEscala): ProjecaoEscala {
  const alunosAlvo = Math.max(0, Math.round(alvo.arenas * alvo.alunosPorArena))
  const alunosHoje = m.alunos

  const tabelasHoje = Object.entries(m.tabelas ?? {})
  const bytesDados = tabelasHoje.reduce((soma, [, v]) => soma + v.bytes, 0)
  const bytesFixos = Math.max(0, m.db_bytes - bytesDados)

  // Sem base para comparar: devolve o cenário zerado em vez de dividir por zero.
  if (alunosHoje <= 0) {
    return {
      alunosAlvo,
      fator: 0,
      confiavel: false,
      ressalva: 'nenhum aluno cadastrado — não há de onde extrapolar',
      bytesFixos,
      dbBytesProjetado: bytesFixos,
      mauProjetado: 0,
      tabelas: [],
      limites: [],
    }
  }

  const fator = alunosAlvo / alunosHoje
  const mauPorAluno = m.mau / alunosHoje

  const tabelas: LinhaProjecao[] = tabelasHoje
    .map(([nome, v]) => ({ nome, atual: v.rows, projetado: v.rows * fator }))
    .sort((a, b) => b.projetado - a.projetado)

  const tabelasProjetadas = Object.fromEntries(
    tabelasHoje.map(([nome, v]) => [nome, { rows: v.rows * fator, bytes: v.bytes * fator }]),
  )

  const dbBytesProjetado = bytesFixos + bytesDados * fator
  const mauProjetado = mauPorAluno * alunosAlvo

  const projetadas: CapacityMetrics = {
    orgs: alvo.arenas,
    orgs_ativas: alvo.arenas,
    alunos: alunosAlvo,
    alunos_ativos: alunosAlvo,
    mau: mauProjetado,
    db_bytes: dbBytesProjetado,
    tabelas: tabelasProjetadas,
  }

  return {
    alunosAlvo,
    fator,
    confiavel: alunosHoje >= ALUNOS_MINIMOS_CONFIAVEL,
    ressalva:
      alunosHoje >= ALUNOS_MINIMOS_CONFIAVEL
        ? null
        : `base pequena demais (${alunosHoje} aluno(s)) — abaixo de ${ALUNOS_MINIMOS_CONFIAVEL} a extrapolação multiplica ruído`,
    bytesFixos,
    dbBytesProjetado,
    mauProjetado,
    tabelas,
    limites: avaliarLimites(projetadas),
  }
}

export type NivelMaturidade = 'recente' | 'parcial' | 'madura'

export interface Maturidade {
  dias: number
  nivel: NivelMaturidade
  /** Frase pronta para a tela, explicando o que a idade faz com a projeção. */
  aviso: string
}

/**
 * Quanto tempo de operação a base tem, e o que isso faz com a extrapolação.
 *
 * Importa porque a projeção assume o histórico por aluno de hoje. Numa base de
 * dois meses, cada aluno tem dois meses de presenças; em regime terá anos. A
 * projeção fica então SUBestimada — e é melhor dizer isso do que deixar alguém
 * ler o número como teto.
 */
export function avaliarMaturidade(primeiraOrgCriadaEm: string | null, agora: Date = new Date()): Maturidade {
  if (!primeiraOrgCriadaEm) {
    return { dias: 0, nivel: 'recente', aviso: 'sem data de início — trate a projeção como piso, não como teto' }
  }

  const inicio = new Date(primeiraOrgCriadaEm).getTime()
  if (Number.isNaN(inicio)) {
    return { dias: 0, nivel: 'recente', aviso: 'sem data de início — trate a projeção como piso, não como teto' }
  }

  const dias = Math.max(0, Math.floor((agora.getTime() - inicio) / 86_400_000))

  if (dias < 180) {
    return {
      dias,
      nivel: 'recente',
      aviso:
        'a base tem menos de 6 meses, então cada aluno acumulou pouco histórico — em regime o volume por aluno é bem maior e estes números são piso, não teto',
    }
  }
  if (dias < 365) {
    return {
      dias,
      nivel: 'parcial',
      aviso:
        'a base ainda não completou um ciclo anual — o histórico por aluno cresce mais um tanto antes de estabilizar',
    }
  }
  return {
    dias,
    nivel: 'madura',
    aviso: 'a base já passou de um ano, então o histórico por aluno está perto do regime',
  }
}
