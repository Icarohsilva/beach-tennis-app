// lib/liga/seasonCloseNotice.ts
// O que o aluno recebe quando a temporada fecha.
//
// Mesmo par do seasonAlert.ts: uma função decide O QUÊ, outra escreve o texto. O
// `closeLigaSeason` só lê standings e despacha — nenhuma regra de mensagem mora lá.

export type SeasonOutcome = 'campeao_subiu' | 'campeao' | 'subiu' | 'caiu'

export interface SeasonCloseInput {
  /** 1º colocado DA DIVISÃO dele — a disputa que ele realmente jogou. */
  champion: boolean
  moved: 'up' | 'down' | null
  /** Pontos que ele fez na temporada que fechou. */
  points: number
}

/**
 * O desfecho da temporada para um aluno, ou null quando não há o que dizer.
 *
 * Quem terminou com zero ponto não recebe nada. Avisar "você caiu de divisão" a quem
 * não apareceu no mês inteiro não é notícia, é cobrança — e cobrança por push termina
 * com o aluno desligando as notificações. Mesma régua do `seasonAlertKind`.
 *
 * Campeão que também subiu vira UM desfecho, não dois: são duas faces do mesmo fato, e
 * dois pushes seguidos sobre a mesma coisa leem como bug.
 */
export function seasonCloseOutcome(input: SeasonCloseInput): SeasonOutcome | null {
  if (input.points <= 0) return null

  if (input.champion) return input.moved === 'up' ? 'campeao_subiu' : 'campeao'
  if (input.moved === 'up') return 'subiu'
  if (input.moved === 'down') return 'caiu'
  return null
}

/**
 * Prioridade quando o aluno se moveu em mais de uma modalidade.
 *
 * Vai um push por aluno (mesma escolha de `sendSeasonEndAlerts`): duas boas notícias no
 * mesmo minuto disputam atenção uma com a outra, e a segunda perde.
 */
const OUTCOME_RANK: Record<SeasonOutcome, number> = {
  campeao_subiu: 0,
  campeao: 1,
  subiu: 2,
  caiu: 3,
}

/** Devolve o desfecho mais importante entre dois. */
export function bestOutcome(a: SeasonOutcome, b: SeasonOutcome): SeasonOutcome {
  return OUTCOME_RANK[a] <= OUTCOME_RANK[b] ? a : b
}

export interface SeasonCloseText {
  title: string
  body: string
}

/**
 * O texto de cada desfecho.
 *
 * O rebaixamento é escrito como convite, não como punição: "você caiu" fecha o assunto,
 * "a temporada nova já começou e dá para voltar" abre. O objetivo do mecanismo inteiro é
 * o aluno voltar para a quadra — inclusive, e principalmente, o que caiu.
 */
export function seasonCloseText(
  outcome: SeasonOutcome,
  params: { sportLabel: string; fromLabel: string; toLabel: string | null },
): SeasonCloseText {
  const { sportLabel, fromLabel, toLabel } = params

  switch (outcome) {
    case 'campeao_subiu':
      return {
        title: `🏆 Campeão da ${fromLabel} e promovido!`,
        body: `Você fechou a temporada de ${sportLabel} em 1º lugar e subiu para a ${toLabel}. A temporada nova já começou — os pontos zeraram, a divisão nova é sua.`,
      }
    case 'campeao':
      return {
        title: `🏆 Você é o campeão da ${fromLabel}`,
        body: `Terminou a temporada de ${sportLabel} em 1º lugar. A temporada nova começou agora: os pontos zeraram e o título é seu para defender.`,
      }
    case 'subiu':
      return {
        title: `⬆️ Você subiu para a ${toLabel}!`,
        body: `Fechou a temporada de ${sportLabel} na zona de promoção e saiu da ${fromLabel}. A disputa agora é mais dura — a temporada nova já está valendo.`,
      }
    case 'caiu':
      return {
        title: `A temporada fechou e você desceu para a ${toLabel}`,
        body: `Ficou entre os últimos da ${fromLabel} em ${sportLabel}. A temporada nova já começou do zero para todo mundo: dá para voltar neste mês.`,
      }
  }
}
