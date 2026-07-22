// lib/utils/attendees.test.ts
import { describe, it, expect } from 'vitest'
import { mergeSessionAttendees } from './attendees'

const ana = { id: 'a', name: 'Ana' }
const bruno = { id: 'b', name: 'Bruno' }
const carla = { id: 'c', name: 'Carla' }
const diego = { id: 'd', name: 'Diego' }

describe('mergeSessionAttendees', () => {
  it('mantém os alunos fixos quando alguém entra na aula (bug do relato)', () => {
    // A turma tem 3 fixos sem reserva gerada; Diego entra avulso.
    const result = mergeSessionAttendees({
      booked: [diego],
      enrolled: [ana, bruno, carla],
      optedOut: new Set(),
    })
    expect(result.map((a) => a.name)).toEqual(['Ana', 'Bruno', 'Carla', 'Diego'])
  })

  it('não duplica quem é fixo e já tem reserva confirmada', () => {
    const result = mergeSessionAttendees({
      booked: [ana, bruno],
      enrolled: [ana, bruno, carla],
      optedOut: new Set(),
    })
    expect(result.map((a) => a.id)).toEqual(['a', 'b', 'c'])
  })

  it('remove o fixo que avisou que não vem nesta data', () => {
    const result = mergeSessionAttendees({
      booked: [diego],
      enrolled: [ana, bruno, carla],
      optedOut: new Set(['b']),
    })
    expect(result.map((a) => a.name)).toEqual(['Ana', 'Carla', 'Diego'])
  })

  it('mantém quem tem reserva confirmada mesmo constando como opt-out', () => {
    // Estado inconsistente não deve esconder quem o banco diz que está dentro.
    const result = mergeSessionAttendees({
      booked: [ana],
      enrolled: [],
      optedOut: new Set(['a']),
    })
    expect(result.map((a) => a.id)).toEqual(['a'])
  })

  it('ordena por nome no padrão pt-BR', () => {
    const result = mergeSessionAttendees({
      booked: [{ id: '1', name: 'Ávila' }],
      enrolled: [{ id: '2', name: 'Ana' }, { id: '3', name: 'Bruno' }],
      optedOut: new Set(),
    })
    expect(result.map((a) => a.name)).toEqual(['Ana', 'Ávila', 'Bruno'])
  })

  it('devolve lista vazia quando não há ninguém', () => {
    expect(mergeSessionAttendees({ booked: [], enrolled: [], optedOut: new Set() })).toEqual([])
  })

  it('só com fixos, sem nenhuma reserva ainda', () => {
    const result = mergeSessionAttendees({
      booked: [],
      enrolled: [carla, ana],
      optedOut: new Set(),
    })
    expect(result.map((a) => a.name)).toEqual(['Ana', 'Carla'])
  })
})
