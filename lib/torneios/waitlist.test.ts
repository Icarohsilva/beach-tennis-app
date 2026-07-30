import { describe, it, expect } from 'vitest'
import { availableSlots, isOfferExpired } from './waitlist'

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
