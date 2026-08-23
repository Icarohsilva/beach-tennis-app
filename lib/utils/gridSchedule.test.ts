import { describe, it, expect } from 'vitest'
import {
  brtToday,
  addDaysStr,
  nextDateForDayOfWeek,
  shouldRunGridNow,
  autoGridWindow,
} from './gridSchedule'

describe('brtToday', () => {
  it('devolve a data BRT (não UTC) — 01:00Z de 18/07 ainda é 17/07 em BRT', () => {
    // 2026-07-18T01:00:00Z = 2026-07-17T22:00:00 BRT.
    expect(brtToday(new Date('2026-07-18T01:00:00Z'))).toBe('2026-07-17')
  })

  it('meio-dia UTC cai no mesmo dia em BRT', () => {
    expect(brtToday(new Date('2026-07-17T12:00:00Z'))).toBe('2026-07-17')
  })
})

describe('addDaysStr', () => {
  it('soma dias a uma data yyyy-MM-dd', () => {
    expect(addDaysStr('2026-07-17', 6)).toBe('2026-07-23')
  })

  it('atravessa a virada de mês', () => {
    expect(addDaysStr('2026-07-30', 6)).toBe('2026-08-05')
  })
})

describe('nextDateForDayOfWeek', () => {
  it('mesma data quando o dia-da-semana já bate (17/07/2026 é sexta = 5)', () => {
    expect(nextDateForDayOfWeek('2026-07-17', 5)).toBe('2026-07-17')
  })

  it('próxima terça (2) a partir de uma sexta', () => {
    // 17/07 sexta → próxima terça é 21/07.
    expect(nextDateForDayOfWeek('2026-07-17', 2)).toBe('2026-07-21')
  })

  it('próximo domingo (0) a partir de uma sexta', () => {
    expect(nextDateForDayOfWeek('2026-07-17', 0)).toBe('2026-07-19')
  })
})

describe('shouldRunGridNow', () => {
  // Alvo: toda segunda (1) às 06:00 BRT. 20/07/2026 é segunda.
  const NOW_MON_7AM = new Date('2026-07-20T10:00:00Z') // 07:00 BRT segunda
  const NOW_MON_5AM = new Date('2026-07-20T08:00:00Z') // 05:00 BRT segunda (antes do alvo)

  it('roda quando passou do alvo e nunca rodou', () => {
    expect(shouldRunGridNow(1, 6, null, NOW_MON_7AM)).toBe(true)
  })

  it('não roda antes da hora-alvo no dia certo', () => {
    // 05:00 BRT segunda: o alvo mais recente é a segunda ANTERIOR 06:00 (13/07).
    // Se nunca rodou, roda esse alvo antigo — mas a marca d'água de "rodou 13/07"
    // impede. Aqui lastRun cobre o alvo de 13/07, então NÃO roda às 05:00.
    expect(shouldRunGridNow(1, 6, '2026-07-13T09:00:00Z', NOW_MON_5AM)).toBe(false)
  })

  it('não roda de novo no mesmo alvo (marca d\'água >= alvo)', () => {
    // lastRun = 20/07 06:30 BRT (09:30Z) cobre o alvo de 20/07 06:00.
    expect(shouldRunGridNow(1, 6, '2026-07-20T09:30:00Z', NOW_MON_7AM)).toBe(false)
  })

  it('roda um alvo atrasado (cron perdeu a hora exata)', () => {
    // Agora é terça 10:00 BRT; alvo era segunda 06:00; última execução foi há 2 semanas.
    const NOW_TUE = new Date('2026-07-21T13:00:00Z') // terça 10:00 BRT
    expect(shouldRunGridNow(1, 6, '2026-07-06T09:00:00Z', NOW_TUE)).toBe(true)
  })

  it('lastRun logo antes do alvo mais recente ainda dispara', () => {
    // Alvo mais recente = 20/07 06:00 BRT (09:00Z). lastRun = 20/07 05:00 BRT (08:00Z) < alvo.
    expect(shouldRunGridNow(1, 6, '2026-07-20T08:00:00Z', NOW_MON_7AM)).toBe(true)
  })
})

// Regressão do relato "configurei sábado 13h e não gerou": a janela precisa
// conter a PRÓXIMA ocorrência do dia escolhido. Com a janela antiga (hoje..+6)
// isso era impossível justamente para o dia da geração.
describe('autoGridWindow', () => {
  const SABADO = '2026-08-22'

  it('cobre 7 dias a partir de amanhã', () => {
    expect(autoGridWindow(SABADO)).toEqual({ from: '2026-08-23', to: '2026-08-29' })
  })

  it('gerando no sábado, o PRÓXIMO sábado entra na janela', () => {
    const { from, to } = autoGridWindow(SABADO)
    const proximoSabado = '2026-08-29'
    expect(from <= proximoSabado && proximoSabado <= to).toBe(true)
  })

  it('a janela antiga (hoje..+6) NÃO continha o próximo sábado — é o defeito', () => {
    const antigaFrom = SABADO
    const antigaTo = addDaysStr(SABADO, 6) // 2026-08-28, uma sexta
    const proximoSabado = '2026-08-29'
    expect(antigaFrom <= proximoSabado && proximoSabado <= antigaTo).toBe(false)
    // E o único sábado que ela continha era o de hoje, já em andamento às 14h.
    expect(antigaFrom).toBe(SABADO)
  })

  it('não inclui hoje, então não cria sessão para aula que já aconteceu', () => {
    expect(autoGridWindow(SABADO).from).not.toBe(SABADO)
  })

  it('vale para qualquer dia da semana, não só sábado', () => {
    // Quarta 26/08 → a próxima quarta é 02/09, dentro da janela.
    const { from, to } = autoGridWindow('2026-08-26')
    expect(from <= '2026-09-02' && '2026-09-02' <= to).toBe(true)
  })
})
