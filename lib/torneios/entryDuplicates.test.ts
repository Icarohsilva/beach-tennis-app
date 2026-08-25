// lib/torneios/entryDuplicates.test.ts
import { describe, it, expect } from 'vitest'
import { findEntrantClash, clashMessage, selfPairError, type ExistingEntry } from './entryDuplicates'

describe('findEntrantClash', () => {
  it('BUG B, lado 1: B é partner_id da inscrição de A; B tenta se inscrever com C', () => {
    const existing: ExistingEntry[] = [{ player_id: 'a', partner_id: 'b' }]
    const clash = findEntrantClash(existing, [{ id: 'b', name: 'Beatriz' }, { id: 'c', name: 'Carlos' }], 'b')
    expect(clash).not.toBeNull()
    expect(clash?.person.id).toBe('b')
    expect(clash?.asPartner).toBe(true)
    expect(clash?.isMe).toBe(true)
    expect(clashMessage(clash!)).toBe('Você já está inscrito neste torneio, como parceiro de outra dupla.')
  })

  it('BUG B, lado 2: A tenta inscrever B, que já tem inscrição própria com C', () => {
    const existing: ExistingEntry[] = [{ player_id: 'b', partner_id: 'c' }]
    const clash = findEntrantClash(existing, [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }], 'a')
    expect(clash).not.toBeNull()
    expect(clash?.person.id).toBe('b')
    expect(clash?.isMe).toBe(false)
    expect(clashMessage(clash!)).toBe('Bruno já está inscrito neste torneio.')
  })

  it('ninguém repetido: null', () => {
    const existing: ExistingEntry[] = [{ player_id: 'x', partner_id: 'y' }]
    expect(findEntrantClash(existing, [{ id: 'a' }, { id: 'b' }], 'a')).toBeNull()
  })

  it('people com parceiro ausente (individual) não estoura', () => {
    const existing: ExistingEntry[] = []
    expect(findEntrantClash(existing, [{ id: 'a' }], 'a')).toBeNull()
  })

  it('o clash escolhido é o primeiro em ordem de people — eu antes do parceiro', () => {
    const existing: ExistingEntry[] = [
      { player_id: 'a', partner_id: null },
      { player_id: 'b', partner_id: null },
    ]
    const clash = findEntrantClash(existing, [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }], 'a')
    expect(clash?.person.id).toBe('a')
  })

  it('sem nome, usa "Este jogador"', () => {
    const existing: ExistingEntry[] = [{ player_id: 'b', partner_id: null }]
    const clash = findEntrantClash(existing, [{ id: 'a' }, { id: 'b' }], 'a')
    expect(clashMessage(clash!)).toBe('Este jogador já está inscrito neste torneio.')
  })
})

describe('selfPairError', () => {
  it('recusa quando o parceiro é a própria pessoa', () => {
    expect(selfPairError('a', 'a')).toMatch(/próprio parceiro/i)
  })

  it('ok quando parceiro é outra pessoa, nulo ou ausente', () => {
    expect(selfPairError('a', 'b')).toBeNull()
    expect(selfPairError('a', null)).toBeNull()
    expect(selfPairError('a', undefined)).toBeNull()
  })
})
