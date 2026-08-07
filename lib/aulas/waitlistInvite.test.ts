import { describe, it, expect } from 'vitest'
import { buildWaitlistInviteMessage, buildWaitlistInviteUrl } from './waitlistInvite'

const BASE = {
  studentName: 'Maria Helena Souza',
  orgName: 'Academia Hudson Barros',
  className: 'Beach Tennis Intermediário',
  sessionDate: '2026-08-08',
  startTime: '08:30:00',
}

describe('buildWaitlistInviteMessage', () => {
  it('trata o aluno pelo primeiro nome', () => {
    const msg = buildWaitlistInviteMessage(BASE)
    expect(msg).toContain('Oi, Maria!')
    expect(msg).not.toContain('Maria Helena Souza')
  })

  it('inclui turma, data e horário da aula', () => {
    const msg = buildWaitlistInviteMessage(BASE)
    expect(msg).toContain('Beach Tennis Intermediário')
    expect(msg).toContain('08:30')
  })

  it('pergunta em vez de afirmar que a vaga é do aluno', () => {
    // Quem coloca o aluno na aula é o professor, depois da resposta — a
    // mensagem não pode prometer a vaga.
    expect(buildWaitlistInviteMessage(BASE)).toContain('Quer entrar?')
  })

  it('não quebra com nome de uma palavra só', () => {
    const msg = buildWaitlistInviteMessage({ ...BASE, studentName: 'Ricardo' })
    expect(msg).toContain('Oi, Ricardo!')
  })
})

describe('buildWaitlistInviteUrl', () => {
  it('monta o link wa.me com a mensagem codificada', () => {
    // Espaço e quebra de linha precisam ir escapados, senão o wa.me trunca o texto.
    const url = buildWaitlistInviteUrl('31996313913', 'Oi, Maria\nAbriu vaga')
    expect(url).toBe('https://wa.me/5531996313913?text=Oi%2C%20Maria%0AAbriu%20vaga')
  })

  it('não duplica o DDI quando o número já tem 55', () => {
    expect(buildWaitlistInviteUrl('5531996313913', 'x')).toContain('wa.me/5531996313913?')
  })

  it('ignora máscara do telefone', () => {
    expect(buildWaitlistInviteUrl('(31) 99631-3913', 'x')).toContain('wa.me/5531996313913?')
  })

  it('devolve null sem telefone — não há para onde mandar', () => {
    expect(buildWaitlistInviteUrl(null, 'x')).toBeNull()
    expect(buildWaitlistInviteUrl('', 'x')).toBeNull()
  })

  it('devolve null para número curto demais para ser um celular', () => {
    expect(buildWaitlistInviteUrl('99631', 'x')).toBeNull()
  })
})
