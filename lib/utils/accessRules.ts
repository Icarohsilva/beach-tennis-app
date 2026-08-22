import { isMissedCheckinBlocked } from '@/lib/checkin/missedCheckins'
import type { CheckinPartner } from '@/types'

/** Como o aluno entra na aula e o que isso consome. */
export type AccessGrant =
  | 'partner' // Wellhub/TotalPass — não consome nada, isento de cota
  | 'plan' // assinatura vigente, dentro da cota
  | 'credit' // debita 1 crédito na reserva
  | 'debt' // entra; pendência nasce se houver presença

export type AccessDenial =
  | 'archived'
  | 'on_vacation'
  | 'blocked_by_debt'
  | 'blocked_by_missed_checkins'
  | 'quota_exhausted'
  | 'daily_cap'

export type AccessDecision = { grant: AccessGrant } | { denied: AccessDenial }

/**
 * O aluno estourou o teto de aulas no dia?
 *
 * `cap <= 0` é "sem teto", não "teto zero": a academia que não quer limite diário
 * grava 0, e ler isso como limite bloquearia todo mundo. Exportada porque as
 * checagens inline de `bookSession` e `addStudentToSession` precisam da MESMA
 * leitura — foi a divergência entre elas que fez 0 virar 2 num lugar e travar tudo
 * no outro.
 */
export function exceedsDailyCap(bookingsOnDate: number, cap: number): boolean {
  if (cap <= 0) return false
  return bookingsOnDate >= cap
}

export interface AccessInput {
  /**
   * Cadastro inativado nesta academia (memberships.archived_at).
   *
   * Precisa estar aqui e não só nas listagens: inativar cancela o plano mas PRESERVA
   * o crédito, então um aluno inativado com saldo passaria pelo `grant: 'credit'` e
   * conseguiria reservar aula sozinho pelo app. Dependente não faz login (não tem
   * auth user), mas aluno adulto faz.
   */
  archived: boolean
  /**
   * O aluno tem férias APROVADAS cobrindo a data da aula.
   *
   * Bloqueia logo depois de `archived` e antes de `partner`: férias é ausência
   * declarada, e nem parceiro nem crédito compram presença de quem avisou que
   * não vem. Sem isto a geração da grade o pouparia e ele entraria sozinho pelo
   * app no dia seguinte, contradizendo o próprio pedido dele.
   */
  onVacation: boolean
  partner: CheckinPartner | null
  /** status='active' E período vigente (isSubscriptionCurrent). Ver spec §1. */
  hasActivePlan: boolean
  creditsBalance: number
  /**
   * payments pendente com session_id não-nulo E missed_checkin = false.
   * A pendência de check-in tem regra própria (openMissedCheckins) e não entra aqui,
   * senão a mesma falta bloquearia por dois caminhos. Ver spec §4.
   */
  hasOpenDebt: boolean
  /** missed_checkins com status='open' do aluno nesta academia. */
  openMissedCheckins: number
  /** system_settings.missed_checkin_block_limit. 0 = regra desligada. */
  missedCheckinBlockLimit: number
  /** system_settings.quota_enforcement_enabled da academia. */
  quotaEnforced: boolean
  /** Aulas que ainda cabem no ciclo. null = aluno sem plano. */
  quotaRemaining: number | null
  /** Reservas confirmadas do aluno na data da sessão pedida. */
  bookingsOnDate: number
  /**
   * Teto do plano, ou o default da academia para quem não tem plano.
   *
   * **0 = sem teto.** É a forma de a academia dizer "pode fazer quantas aulas
   * quiser no dia" sem precisar inventar um número grande. Antes 0 caía num
   * default de 2 e o desligamento era impossível de expressar.
   */
  maxClassesPerDay: number
  /**
   * O aluno escolheu pagar esta aula com crédito avulso, em vez de gastar o plano.
   *
   * Crédito é aula comprada, então ele passa por cima dos dois limites que o plano
   * impõe — a cota do ciclo e o teto diário. Quem paga de novo não está ocupando a
   * vaga que o plano dele já vendeu.
   */
  preferCredit: boolean
}

/**
 * Decide o acesso do aluno a uma aula. Pura: toda busca fica no caller.
 *
 * A dívida bloqueia ANTES de tudo, inclusive quem tem plano. Em seguida vem a
 * pendência de check-in, e só depois o parceiro, que é isento da cota e do teto:
 * quem tem Wellhub e plano ao mesmo tempo, o Wellhub prevalece (spec de cota §4).
 *
 * A pendência de check-in tem que ser avaliada ANTES do grant de parceiro, e não
 * junto da cota: o parceiro é isento de cota e de teto diário, então se a checagem
 * ficasse lá embaixo ela nunca rodaria para quem gera a pendência — e é justamente o
 * aluno de parceiro que a gera. Regra desligada por padrão (limite 0).
 *
 * O teto diário é avaliado ANTES da cota porque, dentro do caminho do plano, é um
 * limite absoluto: com cota sobrando e teto estourado os dois eixos se sobreporiam.
 * Quem escolhe pagar com crédito (`preferCredit`) sai desse caminho antes, porque
 * cota e teto medem consumo de plano e ele não está consumindo plano nenhum.
 *
 * `addStudentToSession` (admin adiciona aluno manualmente numa sessão) passa
 * por aqui como qualquer outro caller — dívida continua sempre ignorada
 * (`hasOpenDebt: false` fixo), mas cota e teto diário agora valem de
 * verdade, com um `force: true` que o admin usa pra furar essa negação
 * especificamente quando decide adicionar mesmo assim.
 */
export function resolveClassAccess(input: AccessInput): AccessDecision {
  // Primeiro de todos, e antes mesmo de `partner`: quem saiu da academia não entra em
  // aula por nenhum caminho — nem por parceiro, nem por crédito que ficou guardado.
  if (input.archived) return { denied: 'archived' }
  if (input.onVacation) return { denied: 'on_vacation' }
  if (input.hasOpenDebt) return { denied: 'blocked_by_debt' }
  if (isMissedCheckinBlocked(input.openMissedCheckins, input.missedCheckinBlockLimit)) {
    return { denied: 'blocked_by_missed_checkins' }
  }
  if (input.partner) return { grant: 'partner' }

  // Pagar com crédito é comprar a aula de novo: nem a cota do ciclo nem o teto
  // diário se aplicam, porque os dois medem o consumo do PLANO. Fica depois das
  // negações de acesso (dívida, inativo, pendência) de propósito — aquelas não são
  // sobre quanto o aluno já usou, e crédito não as compra.
  if (input.preferCredit && input.creditsBalance >= 1) return { grant: 'credit' }

  if (input.quotaEnforced) {
    if (exceedsDailyCap(input.bookingsOnDate, input.maxClassesPerDay)) {
      return { denied: 'daily_cap' }
    }
    if (input.hasActivePlan && (input.quotaRemaining ?? 0) > 0) return { grant: 'plan' }
    if (input.creditsBalance >= 1) return { grant: 'credit' }
    // Plano exausto não vira dívida: cobrar avulsa de quem tem plano não é o
    // que a academia quer. Quem nunca teve plano segue no caminho de baixo.
    if (input.hasActivePlan) return { denied: 'quota_exhausted' }
    return { grant: 'debt' }
  }

  if (input.hasActivePlan) return { grant: 'plan' }
  if (input.creditsBalance >= 1) return { grant: 'credit' }
  return { grant: 'debt' }
}

/**
 * O que fazer com a volta do aluno fixo à aula da qual ele saiu.
 *
 * A vaga da aula fixa continua sendo dele, então voltar não passa pelos eixos de
 * CUSTO (cota do ciclo, teto diário, débito de crédito) — a matrícula já pagou
 * aquela vaga, e `reconcileEnrollment` reserva o fixo de graça pelo mesmo motivo.
 * As negações de SITUAÇÃO (inativo, dívida, pendência de check-in) seguem valendo
 * em `resolveClassAccess`: não são sobre quanto o aluno já usou.
 *
 *   'free'            → a saída não gerou crédito; a volta é grátis e pronto.
 *   'clawback'        → a saída gerou crédito de reposição e o aluno ainda o tem;
 *                       a volta é grátis e o crédito é retomado.
 *   'price_normally'  → a saída gerou crédito e ele JÁ FOI GASTO. Voltar de graça
 *                       daria duas aulas por um pagamento, então esta cobra como
 *                       aula avulsa. Cobrar, e não recusar: recusar deixaria o
 *                       aluno sem caminho de volta, que é o defeito de origem.
 */
export function resolveEnrollmentRejoin(input: {
  /** A saída gerou crédito de reposição (a aula tinha sido paga com crédito). */
  creditRefunded: boolean
  /** Saldo de crédito avulso do aluno agora. */
  creditsBalance: number
}): 'free' | 'clawback' | 'price_normally' {
  if (!input.creditRefunded) return 'free'
  return input.creditsBalance >= 1 ? 'clawback' : 'price_normally'
}
