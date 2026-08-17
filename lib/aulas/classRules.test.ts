import { describe, it, expect } from 'vitest'
import { buildClassRules, type ClassRulesInput } from './classRules'

const BASE: ClassRulesInput = {
  cancellationWindowHours: 5,
  creditExpiryDays: 30,
  quotaEnforced: true,
  plan: { classesPerWeek: 2, cycle: 'monthly', maxClassesPerDay: 2, rolloverUnused: false },
  orgMaxClassesPerDay: 2,
  isPartner: false,
  selfCheckinEnabled: true,
  ligaEnabled: true,
  hasDependents: false,
}

/** Todo o texto das seções, achatado — o jeito mais direto de perguntar "isso aparece?". */
function texto(input: ClassRulesInput): string {
  return buildClassRules(input)
    .flatMap((s) => [s.title, ...s.items.flatMap((i) => [i.text, i.detail ?? ''])])
    .join(' | ')
}

function temSecao(input: ClassRulesInput, id: string): boolean {
  return buildClassRules(input).some((s) => s.id === id)
}

describe('buildClassRules — o que sempre aparece', () => {
  it('as regras de entrar e sair, fila, crédito, mudanças, férias e pendência', () => {
    const ids = buildClassRules(BASE).map((s) => s.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'entrar-sair',
        'fila',
        'creditos',
        'mudancas',
        'ferias',
        'pendencia',
      ]),
    )
  })

  // A reabertura tem dois desfechos diferentes e o aluno precisa saber qual é o
  // dele: o fixo não faz nada, o de crédito tem de entrar de novo.
  it('explica que aula cancelada pode voltar, e para quem a vaga volta sozinha', () => {
    const t = texto(BASE)
    expect(t).toContain('Aula cancelada pode voltar')
    expect(t).toContain('turma fixa recebe a vaga de volta')
    expect(t).toContain('precisa entrar de novo')
  })

  it('nenhuma seção sai vazia', () => {
    for (const s of buildClassRules(BASE)) {
      expect(s.items.length).toBeGreaterThan(0)
    }
  })
})

// O motivo de o módulo existir: número na tela tem de ser o número que o sistema
// aplica. Antes, a janela era configurável na tela do admin e ignorada no código.
describe('buildClassRules — janela de cancelamento', () => {
  it('usa o valor configurado, não um 5 fixo', () => {
    expect(texto({ ...BASE, cancellationWindowHours: 3 })).toContain('3h ou mais')
    expect(texto({ ...BASE, cancellationWindowHours: 8 })).toContain('8h ou mais')
  })

  it('a janela de arrependimento cita a mesma janela configurada', () => {
    expect(texto({ ...BASE, cancellationWindowHours: 3 })).toContain('menos de 3h')
  })

  it('a validade do crédito de reposição sai configurada', () => {
    expect(texto({ ...BASE, creditExpiryDays: 15 })).toContain('15 dias')
  })
})

describe('buildClassRules — cota do plano', () => {
  it('cota ligada com plano mostra o que ele dá', () => {
    expect(texto(BASE)).toContain('Seu plano dá 2 aulas por mês')
  })

  it('plano semanal fala em semana', () => {
    expect(
      texto({ ...BASE, plan: { ...BASE.plan!, cycle: 'weekly' } }),
    ).toContain('2 aulas por semana')
  })

  // Cota desligada = plano ilimitado. Descrever um limite que não existe faria o
  // aluno deixar de marcar aula à toa.
  it('cota desligada esconde a cota, mas mantém o teto diário', () => {
    const t = texto({ ...BASE, quotaEnforced: false })
    expect(t).not.toContain('Seu plano dá')
    expect(t).toContain('Até 2 aulas por dia')
  })

  it('aluno sem plano não vê cota', () => {
    expect(texto({ ...BASE, plan: null })).not.toContain('Seu plano dá')
  })

  it('plano mensal explica o remanejamento; semanal não', () => {
    expect(texto(BASE)).toContain('valem para o mês todo')
    expect(texto({ ...BASE, plan: { ...BASE.plan!, cycle: 'weekly' } })).not.toContain(
      'valem para o mês todo',
    )
  })
})

describe('buildClassRules — acúmulo', () => {
  it('com rollover, diz que a sobra passa adiante', () => {
    const t = texto({ ...BASE, plan: { ...BASE.plan!, rolloverUnused: true } })
    expect(t).toContain('O que sobrar vai para o mês seguinte')
    expect(t).not.toContain('A conta zera')
  })

  it('sem rollover, diz que zera na virada', () => {
    const t = texto(BASE)
    expect(t).toContain('A conta zera na virada do mês')
    expect(t).not.toContain('O que sobrar vai')
  })
})

// 0 = sem limite. A linha tem de sumir: anunciar um teto inexistente é o mesmo
// erro que ignorar um teto que existe.
describe('buildClassRules — teto diário', () => {
  it('teto 0 no plano some da lista', () => {
    expect(texto({ ...BASE, plan: { ...BASE.plan!, maxClassesPerDay: 0 } })).not.toContain('Até ')
  })

  it('teto 0 na academia some para quem não tem plano', () => {
    expect(texto({ ...BASE, plan: null, orgMaxClassesPerDay: 0 })).not.toContain('Até ')
  })

  it('sem plano, o teto vem da academia', () => {
    expect(texto({ ...BASE, plan: null, orgMaxClassesPerDay: 3 })).toContain('Até 3 aulas por dia')
  })

  it('teto 1 fica no singular', () => {
    expect(texto({ ...BASE, plan: { ...BASE.plan!, maxClassesPerDay: 1 } })).toContain(
      'Até 1 aula por dia',
    )
  })
})

// Parceiro é isento de cota e de teto (resolveClassAccess). Mostrar o limite
// para ele seria descrever uma regra que nunca o alcança.
describe('buildClassRules — aluno de parceiro', () => {
  const parceiro = { ...BASE, isPartner: true }

  it('vê a isenção no lugar da cota e do teto', () => {
    const t = texto(parceiro)
    expect(t).toContain('Wellhub/TotalPass')
    expect(t).toContain('Sem limite de aulas por semana nem por dia')
    expect(t).not.toContain('Seu plano dá')
    // "Até N aulas por dia" é a linha do teto; a isenção acima também diz "por
    // dia", então o marcador tem de ser o começo da frase.
    expect(t).not.toContain('Até ')
  })

  it('não vê o bloco de confirmar presença pelo app', () => {
    expect(temSecao(parceiro, 'presenca')).toBe(false)
  })
})

describe('buildClassRules — blocos que dependem da academia', () => {
  it('sem dependentes, o bloco kids some', () => {
    expect(temSecao(BASE, 'kids')).toBe(false)
    expect(temSecao({ ...BASE, hasDependents: true }, 'kids')).toBe(true)
  })

  it('check-in pelo app só quando a academia ativou', () => {
    expect(temSecao(BASE, 'presenca')).toBe(true)
    expect(temSecao({ ...BASE, selfCheckinEnabled: false }, 'presenca')).toBe(false)
  })

  // A Liga tem card próprio, com os pesos reais da academia. Aqui vai só o
  // ponteiro — repetir os pontos é garantir que os dois divirjam.
  it('Liga entra só como ponteiro, e só quando ligada', () => {
    expect(texto(BASE)).toContain('ficam na aba Liga')
    expect(texto(BASE)).not.toContain('pontos')
    expect(temSecao({ ...BASE, ligaEnabled: false }, 'liga')).toBe(false)
  })

  it('a escolha entre plano e crédito só aparece para quem tem plano com cota', () => {
    expect(texto(BASE)).toContain('você escolhe na hora')
    expect(texto({ ...BASE, plan: null })).not.toContain('você escolhe na hora')
  })
})
