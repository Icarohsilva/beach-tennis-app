import { describe, it, expect } from 'vitest'
import { parseNewTrialAccount, parseTrialCpf } from './trialForm'

const OK = {
  name: 'Maria da Silva',
  email: 'Maria@Email.com ',
  phone: '31999998888',
  password: 'segredo',
  gender: 'F',
}

describe('parseTrialCpf', () => {
  it('aceita com ou sem máscara e devolve só os dígitos', () => {
    expect(parseTrialCpf('529.982.247-25')).toEqual({ ok: true, cpf: '52998224725' })
    expect(parseTrialCpf('52998224725')).toEqual({ ok: true, cpf: '52998224725' })
  })

  it('recusa vazio, curto e dígito verificador errado', () => {
    expect(parseTrialCpf('')).toMatchObject({ ok: false, error: 'Informe seu CPF.' })
    expect(parseTrialCpf('123.456')).toMatchObject({ ok: false })
    expect(parseTrialCpf('529.982.247-26')).toMatchObject({ ok: false })
    expect(parseTrialCpf('111.111.111-11')).toMatchObject({ ok: false })
  })
})

describe('parseNewTrialAccount', () => {
  it('normaliza e-mail e WhatsApp', () => {
    const r = parseNewTrialAccount(OK)
    expect(r).toEqual({
      ok: true,
      value: { name: 'Maria da Silva', email: 'maria@email.com', phone: '(31) 99999-8888', password: 'segredo', gender: 'F' },
    })
  })

  it('pede nome completo, e-mail válido, WhatsApp, sexo e senha de 6', () => {
    expect(parseNewTrialAccount({ ...OK, name: 'Maria' })).toMatchObject({ ok: false, error: 'Informe seu nome completo.' })
    expect(parseNewTrialAccount({ ...OK, email: 'maria@' })).toMatchObject({ ok: false, error: 'E-mail inválido.' })
    expect(parseNewTrialAccount({ ...OK, phone: '9999' })).toMatchObject({ ok: false })
    expect(parseNewTrialAccount({ ...OK, gender: null })).toMatchObject({ ok: false, error: 'Informe seu sexo.' })
    expect(parseNewTrialAccount({ ...OK, password: '123' })).toMatchObject({ ok: false })
  })
})
