import { describe, it, expect } from 'vitest'
import { availableSlots, isOfferExpired, newEntryStatus } from './waitlist'

describe('availableSlots', () => {
  it('retorna Infinity quando maxPlayers é null (sem limite)', () => {
    expect(availableSlots(10, null)).toBe(Infinity)
  })
  it('retorna 0 quando torneio está cheio', () => {
    expect(availableSlots(16, 16)).toBe(0)
  })
  it('não retorna negativo quando excede o limite', () => {
    expect(availableSlots(17, 16)).toBe(0)
  })
  it('retorna número de vagas restantes', () => {
    expect(availableSlots(12, 16)).toBe(4)
  })
  it('retorna maxPlayers quando não há inscritos', () => {
    expect(availableSlots(0, 8)).toBe(8)
  })
})

describe('isOfferExpired', () => {
  it('retorna false quando offerExpiresAt é null', () => {
    expect(isOfferExpired(null)).toBe(false)
  })
  it('retorna false quando a oferta é no futuro', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(isOfferExpired(future)).toBe(false)
  })
  it('retorna true quando a oferta está no passado', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(isOfferExpired(past)).toBe(true)
  })
})

describe('newEntryStatus', () => {
  const paid = { entry_status: 'confirmed' as const, payment_status: 'paid' as const, partner_payment_status: null }
  const pending = { ...paid, payment_status: 'pending' as const }

  it('com vaga, confirma', () => {
    expect(newEntryStatus({ occupying: [paid], maxPlayers: 2 })).toBe('confirmed')
    expect(newEntryStatus({ occupying: [paid, paid], maxPlayers: null })).toBe('confirmed')
  })

  it('lotado e tudo pago: esgotado, sem lista de espera', () => {
    expect(newEntryStatus({ occupying: [paid, paid], maxPlayers: 2 })).toBe('full')
    const free = { ...paid, payment_status: 'free' as const }
    expect(newEntryStatus({ occupying: [free, free], maxPlayers: 2 })).toBe('full')
  })

  it('lotado com alguém sem pagar: lista de espera', () => {
    expect(newEntryStatus({ occupying: [paid, pending], maxPlayers: 2 })).toBe('waitlist')
    const partnerPending = { ...paid, partner_payment_status: 'pending' as const }
    expect(newEntryStatus({ occupying: [paid, partnerPending], maxPlayers: 2 })).toBe('waitlist')
    const offered = { ...paid, entry_status: 'offered' as const }
    expect(newEntryStatus({ occupying: [paid, offered], maxPlayers: 2 })).toBe('waitlist')
  })

  it('quem já está na fila não ocupa vaga', () => {
    const waiting = { ...pending, entry_status: 'waitlist' as const }
    expect(newEntryStatus({ occupying: [paid, waiting], maxPlayers: 2 })).toBe('confirmed')
  })
})
