import { describe, it, expect } from 'vitest'
import {
  buildGroupInviteMessage,
  contactsToSheet,
  contactsToVcard,
  normalizeGroupInviteUrl,
  phoneToE164,
} from './whatsappGroup'

describe('normalizeGroupInviteUrl', () => {
  it('aceita o link de convite em qualquer forma que o WhatsApp copia', () => {
    const code = 'AbCdEfGhIj1234567890KL'
    expect(normalizeGroupInviteUrl(`https://chat.whatsapp.com/${code}`)).toBe(`https://chat.whatsapp.com/${code}`)
    expect(normalizeGroupInviteUrl(`chat.whatsapp.com/${code}`)).toBe(`https://chat.whatsapp.com/${code}`)
    expect(normalizeGroupInviteUrl(` https://chat.whatsapp.com/invite/${code}/ `)).toBe(`https://chat.whatsapp.com/${code}`)
    expect(normalizeGroupInviteUrl(`https://chat.whatsapp.com/${code}?mode=ac_t`)).toBe(`https://chat.whatsapp.com/${code}`)
  })

  it('recusa o que não é convite de grupo', () => {
    expect(normalizeGroupInviteUrl('https://wa.me/5511999999999')).toBeNull()
    expect(normalizeGroupInviteUrl('https://example.com/chat.whatsapp.com/abc')).toBeNull()
    expect(normalizeGroupInviteUrl('')).toBeNull()
    expect(normalizeGroupInviteUrl(null)).toBeNull()
  })
})

describe('buildGroupInviteMessage', () => {
  it('chama pelo primeiro nome, diz a arena, o torneio e leva o link', () => {
    const msg = buildGroupInviteMessage({
      toName: 'Gabriella Duarte Almeida',
      tournamentName: 'Super Tiebreak',
      orgName: 'Arena Praia da Serra',
      groupUrl: 'https://chat.whatsapp.com/AbCdEfGhIj12',
    })
    expect(msg).toContain('Oi, Gabriella!')
    expect(msg).toContain('Arena Praia da Serra')
    expect(msg).toContain('Super Tiebreak')
    expect(msg).toContain('https://chat.whatsapp.com/AbCdEfGhIj12')
    expect(msg).not.toContain('senha')
  })
})

describe('contatos dos inscritos em lote', () => {
  const contacts = [
    { name: 'Zeca Souza', phone: '(27) 99999-1111', status: 'confirmed' as const, payment: 'paid' as const },
    { name: 'Ana Lima', phone: '5527988882222', status: 'confirmed' as const, payment: 'pending' as const },
    { name: 'Bia Rocha', phone: null, status: 'confirmed' as const, payment: 'free' as const },
    { name: 'Caio Fila', phone: '27977773333', status: 'waitlist' as const, payment: null },
    { name: 'Ana Repetida', phone: '27 98888-2222', status: 'confirmed' as const, payment: 'paid' as const },
  ]

  it('phoneToE164 aceita o que o cadastro guarda e recusa número incompleto', () => {
    expect(phoneToE164('(27) 99999-1111')).toBe('+5527999991111')
    expect(phoneToE164('5527988882222')).toBe('+5527988882222')
    expect(phoneToE164('99999-1111')).toBeNull()
    expect(phoneToE164(null)).toBeNull()
  })

  it('planilha: inscritos primeiro por nome, fila depois, e quem não tem WhatsApp aparece marcado', () => {
    const sheet = contactsToSheet(contacts)
    expect(sheet.rows.map((r) => r[0])).toEqual(['Ana Lima', 'Ana Repetida', 'Bia Rocha', 'Zeca Souza', 'Caio Fila'])
    expect(sheet.rows[0]).toEqual(['Ana Lima', '(27) 98888-2222', '5527988882222', 'Inscrito', 'Pendente'])
    expect(sheet.rows[2][1]).toBe('SEM WHATSAPP')
    expect(sheet.rows[4][3]).toBe('Lista de espera')
  })

  it('vcf: só inscritos com WhatsApp, sem número repetido, torneio em ORG', () => {
    const vcf = contactsToVcard(contacts, 'Super Tiebreak')
    expect(vcf.match(/BEGIN:VCARD/g)).toHaveLength(2)
    // "ArenaHub" na frente: buscar na agenda traz todos os atletas de uma vez.
    expect(vcf).toContain('FN:ArenaHub Zeca Souza')
    expect(vcf).toContain('TEL;TYPE=CELL:+5527999991111')
    expect(vcf).toContain('ORG:Super Tiebreak')
    expect(vcf).not.toContain('Caio Fila')
    expect(vcf).not.toContain('Bia Rocha')
    expect(contactsToVcard([], 'X')).toBe('')
  })
})
