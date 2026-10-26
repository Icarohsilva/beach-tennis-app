// lib/torneios/schedule/americanoMixed.ts
// Sorteio do Super com a regra "nunca dupla masculina": todo homem joga com uma
// mulher de parceira. Duplas possíveis: MF e FF; confrontos MF x MF, MF x FF e
// FF x FF. Nunca MM, e por isso nunca dois homens contra duas mulheres.
//
// O Super comum (americano.ts) usa o método do círculo, em que cada par de
// jogadores forma dupla exatamente uma vez. Isso é incompatível com a regra: o
// círculo obrigatoriamente junta homem com homem. Aqui cada rodada é montada por
// busca, com a mesma intenção do círculo:
//   1. descansa quem jogou mais (jogos equilibrados, diferença máxima de 1);
//   2. forma as duplas sem MM, evitando repetir parceiro;
//   3. casa as duplas em confrontos evitando repetir adversário.
// Mesmo número de rodadas e de jogos por rodada do Super comum.
//
// A mesma busca serve a segunda regra de gênero, "confrontos do mesmo tipo"
// (`generateSameTypeAmericanoSchedule`): cada jogo é MM x MM, FF x FF ou misto x
// misto, nunca dupla masculina contra mista ou feminina. Com 4 homens e 4
// mulheres ela fecha perfeita: 3 rodadas de MM x MM + FF x FF e 4 de misto x
// misto, e cada um joga uma vez com cada outro como parceiro.
//
// Puro e determinístico: a aleatoriedade fica na ordem de entrada, que a action
// já sorteia antes de chamar.
import type { Gender } from '@/types'
import type { MatchPlan, RoundPlan } from '../types'

export interface DrawPlayer {
  id: string
  gender: Gender | null
}

/** Erro que vai inteiro para a tela do admin: a rodada não sai com a regra quebrada. */
export class DrawRuleError extends Error {}

/** Teto de nós da busca de duplas por rodada: mantém o sorteio instantâneo com 16 jogadores. */
const PAIRING_NODE_BUDGET = 20_000

/** Quantos jogos cabem por rodada e quantos descansam, igual ao Super comum. */
export function roundShape(n: number): { matches: number; resting: number } {
  const matches = Math.floor(n / 4)
  return { matches, resting: n - matches * 4 }
}

/**
 * Quantas rodadas o Super tem para TODO MUNDO jogar o mesmo número de jogos.
 *
 * Com N múltiplo de 4 ninguém descansa e as N−1 rodadas fecham a conta. Com 6,
 * 10 ou 14 sobram 2 de fora a cada rodada, e em N−1 rodadas não fecha: com 10
 * são 9 × 8 = 72 vagas para 10 pessoas, então duas jogavam 8 e as outras 7 —
 * vantagem direta numa classificação que soma vitórias e games. Com N rodadas
 * cada um joga N−2.
 */
export function superRounds(n: number): number {
  return n % 4 === 0 ? n - 1 : n
}

/**
 * A regra cabe nestes jogadores? Cada homem em quadra precisa de uma parceira,
 * então em cada rodada no máximo metade de quem joga pode ser homem; o excesso
 * tem de estar descansando.
 */
export function mixedDrawProblem(players: DrawPlayer[]): string | null {
  const n = players.length
  if (n < 4 || n > 16 || n % 2 !== 0) return 'Super aceita apenas um número par de 4 a 16 jogadores.'
  const unknown = players.filter((p) => p.gender !== 'M' && p.gender !== 'F').length
  if (unknown > 0) {
    return `${unknown} jogador(es) sem gênero no cadastro. Complete o gênero para sortear sem dupla masculina.`
  }
  const men = players.filter((p) => p.gender === 'M').length
  const women = n - men
  const { matches, resting } = roundShape(n)
  if (men > matches * 2 + resting) {
    return (
      `Com ${men} homens e ${women} mulheres não dá para montar as rodadas sem dupla masculina: ` +
      `cada rodada tem ${matches * 2} vagas para homem em quadra. Desligue a regra ou ajuste os inscritos.`
    )
  }
  // O homem que não cabe em quadra descansa em toda rodada. Se isso passa da
  // parte justa de descanso dos homens, as mulheres jogam mais partidas que
  // eles — e a classificação, que soma vitórias e games, vira vantagem delas.
  const menMustRest = Math.max(0, men - matches * 2)
  if (menMustRest * n > men * resting) {
    return (
      `Com ${men} homens e ${women} mulheres não dá para todos jogarem o mesmo número de partidas ` +
      `sem dupla masculina: ${menMustRest} homens descansam em toda rodada, e as mulheres jogariam mais ` +
      `que eles. Desligue a regra ou ajuste os inscritos.`
    )
  }
  return null
}

/**
 * A regra "confrontos do mesmo tipo" cabe nestes jogadores?
 *
 * Cada jogo usa um número PAR de homens (4, 2 ou 0) e de mulheres. Sem
 * descanso (8, 12, 16 jogadores), isso pede homens em número par. Com 2 de
 * fora por rodada (6, 10, 14), dá sempre, mas com homens em número ímpar
 * descansa um homem em TODA rodada, e só fica justo se metade for homem (o
 * mesmo número de descansos de todo mundo).
 */
export function sameTypeDrawProblem(players: DrawPlayer[]): string | null {
  const n = players.length
  if (n < 4 || n > 16 || n % 2 !== 0) return 'Super aceita apenas um número par de 4 a 16 jogadores.'
  const unknown = players.filter((p) => p.gender !== 'M' && p.gender !== 'F').length
  if (unknown > 0) {
    return `${unknown} jogador(es) sem sexo no cadastro. Defina o sexo para sortear confrontos do mesmo tipo.`
  }
  const men = players.filter((p) => p.gender === 'M').length
  const women = n - men
  const { resting } = roundShape(n)
  if (men % 2 === 1 && (resting === 0 || men !== women)) {
    return (
      `Com ${men} homens e ${women} mulheres não dá para todos os jogos serem do mesmo tipo ` +
      '(MM x MM, FF x FF ou misto x misto) com todo mundo jogando o mesmo número de partidas: ' +
      'é preciso um número par de homens. Escolha outra regra de sorteio ou ajuste os inscritos.'
    )
  }
  return null
}

/** Quantas ordens de desempate são tentadas; fica a de melhor rodízio. */
const ATTEMPTS = 24
/**
 * Teto de tempo das tentativas. Com 16 jogadores e meio a meio cada tentativa
 * custa dezenas de ms; o teto segura o botão "Gerar chave" responsivo mesmo
 * numa função fria. Passou do tempo, fica a melhor até ali (sempre válida).
 */
const ATTEMPTS_BUDGET_MS = 1_200

export function generateMixedAmericanoSchedule(players: DrawPlayer[]): RoundPlan[] {
  const problem = mixedDrawProblem(players)
  if (problem) throw new DrawRuleError(problem)
  return searchSchedule(players.map((p) => ({ id: p.id, man: p.gender === 'M' })), 'no_male_pairs')
}

/** Super em que todo jogo é do mesmo tipo: MM x MM, FF x FF ou misto x misto. */
export function generateSameTypeAmericanoSchedule(players: DrawPlayer[]): RoundPlan[] {
  const problem = sameTypeDrawProblem(players)
  if (problem) throw new DrawRuleError(problem)
  const plan = searchSchedule(players.map((p) => ({ id: p.id, man: p.gender === 'M' })), 'same_type')
  // A regra de descanso deixa o número de jogos igual; se a busca não achou,
  // é melhor recusar do que gravar uma chave em que alguém joga a mais.
  const plays = new Map<string, number>()
  for (const round of plan) {
    for (const g of round.matches) {
      for (const id of [g.p1, g.partner1, g.p2, g.partner2]) if (id) plays.set(id, (plays.get(id) ?? 0) + 1)
    }
  }
  const counts = players.map((p) => plays.get(p.id) ?? 0)
  if (Math.max(...counts) !== Math.min(...counts)) {
    throw new DrawRuleError('Não foi possível sortear confrontos do mesmo tipo com todos jogando o mesmo número de partidas.')
  }
  return plan
}

/**
 * O Super SEM regra de gênero, pela mesma busca. É o caminho do Super comum com
 * 6, 10 ou 14 jogadores: ali o método do círculo de americano.ts não fecha em
 * jogos iguais (ver superRounds).
 */
export function generateBalancedAmericanoSchedule(playerIds: string[]): RoundPlan[] {
  return searchSchedule(playerIds.map((id) => ({ id, man: false })), 'free')
}

interface SearchPlayer {
  id: string
  man: boolean
}

/** Qual regra de gênero a busca obedece. */
type DrawMode = 'free' | 'no_male_pairs' | 'same_type'

function searchSchedule(players: SearchPlayer[], mode: DrawMode): RoundPlan[] {
  // A busca de cada rodada é gulosa (olha só o passado), e a ordem de desempate
  // muda o resultado. Tentar algumas ordens e ficar com a de menos repetição
  // custa milissegundos e tira repetições que a primeira ordem deixava.
  let best: { plan: RoundPlan[]; score: number } | null = null
  const deadline = Date.now() + ATTEMPTS_BUDGET_MS
  for (let k = 0; k < ATTEMPTS && (k === 0 || Date.now() < deadline); k++) {
    const order = k === 0 ? players.map((_, i) => i) : seededPermutation(players.length, k)
    const attempt = buildSchedule(order.map((i) => players[i]), mode)
    if (!best || attempt.score < best.score) best = attempt
    if (best.score === 0) break
  }
  return best!.plan
}

/**
 * Nota do sorteio (menor é melhor): qualquer diferença no número de jogos pesa
 * mais que tudo, depois parceiro repetido, depois adversário repetido. O piso de
 * repetição imposto pela própria regra (poucas mulheres para muitos homens)
 * entra igual em todas as tentativas, então não distorce a escolha.
 */
function scheduleScore(plays: number[], partnered: number[][], opposed: number[][]): number {
  const spread = Math.max(...plays) - Math.min(...plays)
  let partnerRepeat = 0
  let opponentRepeat = 0
  for (let a = 0; a < plays.length; a++) {
    for (let b = a + 1; b < plays.length; b++) {
      if (partnered[a][b] > 1) partnerRepeat += (partnered[a][b] - 1) ** 2
      if (opposed[a][b] > 2) opponentRepeat += (opposed[a][b] - 2) ** 2
    }
  }
  return spread * 1_000_000 + partnerRepeat * 1_000 + opponentRepeat
}

/** Permutação determinística (mulberry32 + Fisher-Yates): mesmo k, mesma ordem. */
function seededPermutation(n: number, seed: number): number[] {
  let t = seed * 0x9e3779b9
  const rand = () => {
    t = (t + 0x6d2b79f5) | 0
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  const out = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function buildSchedule(players: SearchPlayer[], mode: DrawMode): { plan: RoundPlan[]; score: number } {
  const n = players.length
  const isMan = players.map((p) => p.man)
  const { matches: perRound, resting: restSize } = roundShape(n)
  const totalMen = isMan.filter(Boolean).length
  // Sem dupla masculina, o homem que não cabe em quadra descansa. Nas outras
  // regras não há teto de homem em quadra.
  const menMustRest = mode === 'no_male_pairs' ? Math.max(0, totalMen - perRound * 2) : 0

  const plays = new Array<number>(n).fill(0)
  const lastRest = new Array<number>(n).fill(-1)
  const partnered = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const opposed = Array.from({ length: n }, () => new Array<number>(n).fill(0))

  const plan: RoundPlan[] = []
  for (let r = 0; r < superRounds(n); r++) {
    // 1. Quem descansa: quem jogou mais, e entre esses quem descansou há mais
    // tempo. Homens primeiro quando o excesso deles obriga.
    const restOrder = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => plays[b] - plays[a] || lastRest[a] - lastRest[b] || ((a - r + n) % n) - ((b - r + n) % n),
    )
    const resting = new Set<number>()
    if (mode === 'same_type' && restSize > 0) {
      // Todo jogo usa homens e mulheres em número par, então quem joga também
      // precisa ser par dos dois lados: com homens em número par descansam dois
      // do mesmo sexo; com ímpar, um homem e uma mulher.
      const first = restOrder[0]
      const wantSame = totalMen % 2 === 0
      const second = restOrder.find((j) => j !== first && (isMan[j] === isMan[first]) === wantSame)
      resting.add(first)
      if (second !== undefined) resting.add(second)
    } else {
      for (const i of restOrder) {
        if (resting.size >= menMustRest) break
        if (isMan[i]) resting.add(i)
      }
      for (const i of restOrder) {
        if (resting.size >= restSize) break
        resting.add(i)
      }
    }
    const playing = Array.from({ length: n }, (_, i) => i).filter((i) => !resting.has(i))

    // 2. Duplas dentro da regra, com o mínimo de parceiro repetido.
    const pairs = bestPairing(playing, isMan, partnered, mode)
    if (!pairs) {
      // Não acontece com a checagem de viabilidade aprovada; a trava fica para
      // nunca gravar uma rodada que quebre a regra.
      throw new DrawRuleError(`Não foi possível montar a rodada ${r + 1} dentro da regra de sorteio.`)
    }

    // 3. Confrontos com o mínimo de adversário repetido.
    const games = bestMatchup(pairs, opposed, mode === 'same_type' ? (a, b) => pairKind(a, isMan) === pairKind(b, isMan) : null)
    if (games.length * 2 !== pairs.length) {
      throw new DrawRuleError(`Não foi possível montar os confrontos da rodada ${r + 1} dentro da regra de sorteio.`)
    }

    const matchPlans: MatchPlan[] = games.map(([a, b]) => ({
      p1: players[a[0]].id,
      partner1: players[a[1]].id,
      p2: players[b[0]].id,
      partner2: players[b[1]].id,
    }))
    for (const [a, b] of games) {
      partnered[a[0]][a[1]]++
      partnered[a[1]][a[0]]++
      partnered[b[0]][b[1]]++
      partnered[b[1]][b[0]]++
      for (const x of a) {
        for (const y of b) {
          opposed[x][y]++
          opposed[y][x]++
        }
      }
      for (const i of [...a, ...b]) plays[i]++
    }
    resting.forEach((i) => { lastRest[i] = r })

    plan.push({ round: r + 1, matches: matchPlans, resting: Array.from(resting).map((i) => players[i].id) })
  }
  return { plan, score: scheduleScore(plays, partnered, opposed) }
}

/**
 * Duplas de `playing` sem homem com homem, minimizando parceiros repetidos.
 * Busca em profundidade com poda: os homens primeiro (cada um precisa de uma
 * mulher, é o que mais restringe), parceiros mais "novos" primeiro, para a
 * primeira solução já ser boa e a poda cortar o resto.
 */
/** Tipo da dupla pelo número de homens: 0 = feminina, 1 = mista, 2 = masculina. */
function pairKind(pair: [number, number], isMan: boolean[]): number {
  return Number(isMan[pair[0]]) + Number(isMan[pair[1]])
}

function bestPairing(
  playing: number[],
  isMan: boolean[],
  partnered: number[][],
  mode: DrawMode,
): [number, number][] | null {
  const order = [...playing].sort((a, b) => Number(isMan[b]) - Number(isMan[a]))
  const used = new Set<number>()
  const current: [number, number][] = []
  let best: [number, number][] | null = null
  let bestCost = Infinity
  let nodes = 0

  // Custo quadrático: duas repetições na mesma dupla pesam mais que duas
  // duplas repetindo uma vez cada.
  const cost = (a: number, b: number) => partnered[a][b] * partnered[a][b] * 10 + partnered[a][b]

  function dfs(acc: number) {
    if (acc >= bestCost || nodes > PAIRING_NODE_BUDGET) return
    nodes++
    const first = order.find((i) => !used.has(i))
    if (first === undefined) {
      // Confrontos do mesmo tipo: cada tipo de dupla precisa de um par para
      // enfrentar, então a quantidade de cada tipo tem de ser par.
      if (mode === 'same_type') {
        const kinds = [0, 0, 0]
        for (const p of current) kinds[pairKind(p, isMan)]++
        if (kinds.some((k) => k % 2 !== 0)) return
      }
      bestCost = acc
      best = current.map((p) => [p[0], p[1]])
      return
    }
    // Os homens vêm primeiro na ordem; quando o próximo é mulher, todas as
    // duplas com homem já estão feitas. Em "mesmo tipo", masculinas e mistas
    // têm de estar em número par AQUI: o que falta são só femininas, que não
    // mudam essas contas. Cortar agora evita varrer todas as combinações de
    // mulheres de um ramo que nunca fecha (2 homens juntos com 14 mulheres
    // estourava o teto de nós sem achar nada).
    if (mode === 'same_type' && !isMan[first]) {
      let maleOrMixed = [0, 0]
      for (const p of current) {
        const kind = pairKind(p, isMan)
        if (kind === 2) maleOrMixed = [maleOrMixed[0] + 1, maleOrMixed[1]]
        if (kind === 1) maleOrMixed = [maleOrMixed[0], maleOrMixed[1] + 1]
      }
      if (maleOrMixed[0] % 2 !== 0 || maleOrMixed[1] % 2 !== 0) return
    }
    used.add(first)
    const candidates = order
      .filter((j) => !used.has(j) && !(mode === 'no_male_pairs' && isMan[first] && isMan[j]))
      .sort((a, b) => cost(first, a) - cost(first, b))
    for (const j of candidates) {
      used.add(j)
      current.push([first, j])
      dfs(acc + cost(first, j))
      current.pop()
      used.delete(j)
      if (bestCost === 0) break
    }
    used.delete(first)
  }

  dfs(0)
  return best
}

/** Casa as duplas em confrontos, minimizando adversários repetidos (busca completa: no máximo 8 duplas). */
function bestMatchup(
  pairs: [number, number][],
  opposed: number[][],
  canFace: ((a: [number, number], b: [number, number]) => boolean) | null,
): [[number, number], [number, number]][] {
  let best: [[number, number], [number, number]][] = []
  let bestCost = Infinity
  const current: [[number, number], [number, number]][] = []
  const used = new Array<boolean>(pairs.length).fill(false)

  const cost = (a: [number, number], b: [number, number]) => {
    let c = 0
    for (const x of a) for (const y of b) c += opposed[x][y] * opposed[x][y]
    return c
  }

  function dfs(acc: number) {
    if (acc >= bestCost) return
    const first = used.indexOf(false)
    if (first === -1) {
      bestCost = acc
      best = current.map((m) => [m[0], m[1]])
      return
    }
    used[first] = true
    for (let j = first + 1; j < pairs.length; j++) {
      if (used[j]) continue
      if (canFace && !canFace(pairs[first], pairs[j])) continue
      used[j] = true
      current.push([pairs[first], pairs[j]])
      dfs(acc + cost(pairs[first], pairs[j]))
      current.pop()
      used[j] = false
    }
    used[first] = false
  }

  dfs(0)
  return best
}
