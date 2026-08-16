// lib/aulas/classRules.ts
// As regras do sistema, do jeito que o aluno lê — derivadas da configuração REAL
// da academia.
//
// Fonte única do que aparece no modal de regras do dashboard. Regra nova ou
// alterada no sistema tem de passar por aqui, senão o app segue prometendo o que
// não faz mais (ver CLAUDE.md).
//
// Derivado e não texto fixo pelo mesmo motivo do RulesCard da Liga: quase tudo
// aqui é configurável por academia — cota ligada ou não, teto diário, janela de
// cancelamento, validade do crédito, check-in pelo app, acúmulo por plano. Um
// texto fixo mentiria para metade das arenas no dia do deploy, e mentira em tela
// de regra é pior que ausência de tela.
//
// Puro, sem I/O, no padrão de accessRules.ts e classQuota.ts: o caller busca a
// configuração (features/aulas/classRulesQuery.ts) e aqui só se decide o que
// entra e com que número.
import { BOOKING_GRACE_MINUTES } from '@/lib/utils/creditRules'
import type { PlanCycle } from '@/lib/utils/classQuota'

export interface RuleItem {
  text: string
  /** Linha de apoio, quando a regra precisa de um porquê para não soar arbitrária. */
  detail?: string
}

export interface RuleSection {
  /** Chave estável para `key` do React e para os testes apontarem a seção. */
  id: string
  title: string
  items: RuleItem[]
}

export interface ClassRulesInput {
  /** system_settings.cancellation_window_hours da academia. */
  cancellationWindowHours: number
  /** system_settings.credit_expiry_days — vale só para o crédito de reposição. */
  creditExpiryDays: number
  /** system_settings.quota_enforcement_enabled. Desligada, o plano é ilimitado. */
  quotaEnforced: boolean
  /** Plano vigente do aluno, ou null. */
  plan: {
    classesPerWeek: number
    cycle: PlanCycle
    maxClassesPerDay: number
    rolloverUnused: boolean
  } | null
  /** Teto diário da academia, para quem não tem plano. 0 = sem teto. */
  orgMaxClassesPerDay: number
  /** Wellhub/TotalPass: isento de cota e de teto. */
  isPartner: boolean
  /** organizations.self_checkin_enabled. */
  selfCheckinEnabled: boolean
  /** A Liga está ligada nesta academia. */
  ligaEnabled: boolean
  /** O aluno é responsável por alguma criança. */
  hasDependents: boolean
}

/** "nesta semana" / "neste mês", conforme o ciclo do plano. */
function periodo(cycle: PlanCycle): string {
  return cycle === 'weekly' ? 'por semana' : 'por mês'
}

/** "a semana" / "o mês" — para frases como "vai para a semana seguinte". */
function cicloLabel(cycle: PlanCycle): string {
  return cycle === 'weekly' ? 'a semana' : 'o mês'
}

/** "da semana" / "do mês" — a mesma palavra com a preposição contraída. */
function daVirada(cycle: PlanCycle): string {
  return cycle === 'weekly' ? 'da semana' : 'do mês'
}

/** Plural sem gambiarra de template no meio do texto. */
function aulas(n: number): string {
  return n === 1 ? '1 aula' : `${n} aulas`
}

/**
 * As seções do modal, na ordem em que o aluno precisa delas.
 *
 * Seção sem item nenhum é descartada no fim: é o que faz a academia que desligou
 * um recurso simplesmente não ver aquele bloco, em vez de ver um título vazio.
 */
export function buildClassRules(input: ClassRulesInput): RuleSection[] {
  const sections: RuleSection[] = []

  // ── Suas aulas ───────────────────────────────────────────────────────────
  const suasAulas: RuleItem[] = []

  if (input.isPartner) {
    // Parceiro é isento dos dois limites (resolveClassAccess). Mostrar a cota
    // para ele seria descrever uma regra que nunca o alcança.
    suasAulas.push({
      text: 'Você entra pelo Wellhub/TotalPass',
      detail: 'Sem limite de aulas por semana nem por dia. Faça o check-in na recepção.',
    })
  } else if (input.quotaEnforced && input.plan) {
    suasAulas.push({
      text: `Seu plano dá ${aulas(input.plan.classesPerWeek)} ${periodo(input.plan.cycle)}`,
      detail: 'O total e o quanto já usou aparecem no topo desta tela.',
    })

    if (input.plan.cycle === 'monthly') {
      suasAulas.push({
        text: 'As aulas valem para o mês todo',
        detail: 'Dá para fazer mais numa semana e menos na outra, fechando o mês no total.',
      })
    }

    if (input.plan.rolloverUnused) {
      suasAulas.push({
        text: `O que sobrar vai para ${cicloLabel(input.plan.cycle)} seguinte`,
        detail: 'As aulas guardadas somam com as novas, e não expiram.',
      })
    } else {
      suasAulas.push({
        text: `A conta zera na virada ${daVirada(input.plan.cycle)}`,
        detail: 'Aula não usada não passa para o período seguinte.',
      })
    }
  }

  // Teto diário: 0 é "sem limite" e nesse caso a linha some — anunciar um limite
  // que não existe faria o aluno deixar de marcar aula à toa.
  const teto = input.plan?.maxClassesPerDay ?? input.orgMaxClassesPerDay
  if (!input.isPartner && teto > 0) {
    suasAulas.push({
      text: `Até ${aulas(teto)} por dia`,
      detail: 'Usando crédito avulso, esse limite não se aplica.',
    })
  }

  if (suasAulas.length > 0) {
    sections.push({ id: 'aulas', title: 'Suas aulas', items: suasAulas })
  }

  // ── Entrar e sair ────────────────────────────────────────────────────────
  const h = input.cancellationWindowHours
  sections.push({
    id: 'entrar-sair',
    title: 'Entrar e sair da aula',
    items: [
      {
        text: `Cancele com ${h}h ou mais de antecedência`,
        detail: 'Você não leva falta e a aula volta para você.',
      },
      {
        text: `Entrou por engano? Você tem ${BOOKING_GRACE_MINUTES} minutos para sair sem perder nada`,
        detail: `Vale mesmo que falte menos de ${h}h para a aula.`,
      },
      {
        text: 'Em cima da hora, a aula conta como usada',
        detail: 'Passadas as duas janelas acima, sair custa a aula.',
      },
      {
        text: 'Aluno de turma fixa que avisa recebe crédito de reposição',
      },
    ],
  })

  // ── Fila de espera ───────────────────────────────────────────────────────
  sections.push({
    id: 'fila',
    title: 'Turma cheia',
    items: [
      { text: 'Entre na lista de espera pela própria ficha da aula' },
      {
        text: 'Abriu vaga, todo mundo da fila é avisado',
        detail: 'A vaga fica com quem entrar primeiro — deixe as notificações ligadas.',
      },
    ],
  })

  // ── Créditos ─────────────────────────────────────────────────────────────
  const creditos: RuleItem[] = [
    {
      text: 'Crédito avulso é separado do plano',
      detail: 'Ele não gasta as aulas do seu plano nem esbarra no limite do dia.',
    },
  ]
  if (input.quotaEnforced && input.plan) {
    creditos.push({
      text: 'Tendo os dois, você escolhe na hora de entrar',
      detail: 'A ficha da aula pergunta se quer usar a aula do plano ou 1 crédito.',
    })
  }
  creditos.push({
    text: `Só o crédito de reposição tem prazo: ${input.creditExpiryDays} dias`,
    detail:
      'É o que nasce quando você cancela uma avulsa paga. Crédito comprado, dado pela academia ou devolvido por aula cancelada fica até ser usado.',
  })
  sections.push({ id: 'creditos', title: 'Créditos', items: creditos })

  // ── Quando a arena mexe na aula ──────────────────────────────────────────
  sections.push({
    id: 'mudancas',
    title: 'Se a arena mudar ou cancelar a aula',
    items: [
      {
        text: 'Aula cancelada não custa nada a você',
        detail:
          'Sem falta: quem usou crédito recebe de volta e a aula não conta na sua cota. Avisamos pelo app com o motivo, e ela fica marcada na agenda.',
      },
      {
        text: 'Horário alterado aparece marcado como "Alterada"',
        detail: 'Confira pelo app antes de sair de casa — a agenda mostra o horário novo.',
      },
    ],
  })

  // ── Férias ───────────────────────────────────────────────────────────────
  sections.push({
    id: 'ferias',
    title: 'Férias',
    items: [
      {
        text: 'Vai viajar? Peça férias no seu Perfil',
        detail: 'A academia aprova, e aí você sai das aulas do período sem levar falta.',
      },
      {
        text: 'Enquanto o pedido não for aprovado, nada muda',
        detail: 'Suas aulas seguem normais até a resposta.',
      },
      { text: 'A mensalidade não é alterada pelas férias' },
    ],
  })

  // ── Kids ─────────────────────────────────────────────────────────────────
  if (input.hasDependents) {
    sections.push({
      id: 'kids',
      title: 'Aulas dos seus dependentes',
      items: [
        {
          text: 'A aula do seu filho aparece na sua agenda',
          detail: 'É você quem coloca e tira ele da turma, pelo seu próprio app.',
        },
        {
          text: 'Turma kids é só para criança',
          detail: 'Adulto vê a aula na agenda, mas quem entra é o dependente.',
        },
      ],
    })
  }

  // ── Confirmar presença ───────────────────────────────────────────────────
  if (input.selfCheckinEnabled && !input.isPartner) {
    sections.push({
      id: 'presenca',
      title: 'Confirmar presença',
      items: [
        {
          text: 'Confirme pelo app quando chegar na quadra',
          detail: 'A janela abre 1h antes do início e fecha 1h depois do fim da aula.',
        },
      ],
    })
  }

  // ── Pendência ────────────────────────────────────────────────────────────
  sections.push({
    id: 'pendencia',
    title: 'Pendência financeira',
    items: [
      {
        text: 'Ficando com pendência em aberto, o agendamento trava',
        detail: 'Regularize em Financeiro para voltar a marcar aula.',
      },
    ],
  })

  // ── Liga ─────────────────────────────────────────────────────────────────
  // Só o ponteiro: a Liga tem card próprio, com os pesos reais desta academia
  // (features/liga/RulesCard.tsx). Repetir aqui garante que os dois divirjam.
  if (input.ligaEnabled) {
    sections.push({
      id: 'liga',
      title: 'Liga',
      items: [
        {
          text: 'As regras de pontuação ficam na aba Liga',
          detail: 'Lá você vê quanto vale cada coisa e como funcionam as divisões.',
        },
      ],
    })
  }

  return sections.filter((s) => s.items.length > 0)
}
