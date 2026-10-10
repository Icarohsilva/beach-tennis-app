import { describe, it, expect } from 'vitest'
import {
  checkEntryMove, repriceSide, paidDifferenceNotice, resolveTargetConflicts,
  type MoveTournament, type TargetEntryRef,
} from './moveEntry'

const source: MoveTournament = {
  id: 's', name: 'Categoria C', status: 'open', participant_type: 'dupla_fixa',
  allowed_pair_genders: ['MM', 'MF', 'FF'], max_players: 16,
}
const target: MoveTournament = { ...source, id: 't', name: 'Categoria D' }
const pair = { entryStatus: 'confirmed' as const, playerGender: 'M' as const, partnerGender: 'M' as const }
const base = { entry: pair, source, target, targetOccupied: 3, clash: null }

describe('checkEntryMove', () => {
  it('move a dupla confirmada para outra categoria aberta', () => {
    expect(checkEntryMove(base)).toEqual({ ok: true })
  })

  it('recusa o mesmo torneio', () => {
    expect(checkEntryMove({ ...base, target: source }).ok).toBe(false)
  })

  it('recusa quando a chave de qualquer um dos dois já foi gerada', () => {
    expect(checkEntryMove({ ...base, source: { ...source, status: 'in_progress' } }).ok).toBe(false)
    expect(checkEntryMove({ ...base, target: { ...target, status: 'finished' } }).ok).toBe(false)
    expect(checkEntryMove({ ...base, target: { ...target, status: 'draft' } }).ok).toBe(true)
  })

  it('recusa formato de inscrição diferente', () => {
    const r = checkEntryMove({ ...base, target: { ...target, participant_type: 'individual' } })
    expect(r.ok).toBe(false)
  })

  it('aplica a regra de gênero do destino', () => {
    const r = checkEntryMove({ ...base, target: { ...target, allowed_pair_genders: ['FF'] } })
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.reason).toContain('Categoria D')
    // Dupla incompleta: só o titular é conferido.
    const solo = { entryStatus: 'confirmed' as const, playerGender: 'F' as const }
    expect(checkEntryMove({ ...base, entry: solo, target: { ...target, allowed_pair_genders: ['FF'] } }).ok).toBe(true)
  })

  it('recusa quem já está no destino', () => {
    const r = checkEntryMove({ ...base, clash: { name: 'Ana', kind: 'enrolled' } })
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.reason).toContain('Ana')
    const shared = checkEntryMove({ ...base, clash: { name: 'Ana', kind: 'shared_waitlist' } })
    if (!shared.ok) expect(shared.reason).toContain('lista de espera')
  })

  it('confirmada precisa de vaga; fila de espera não ocupa vaga', () => {
    expect(checkEntryMove({ ...base, targetOccupied: 16 }).ok).toBe(false)
    const waiting = { ...pair, entryStatus: 'waitlist' as const }
    expect(checkEntryMove({ ...base, entry: waiting, targetOccupied: 16 }).ok).toBe(true)
    expect(checkEntryMove({ ...base, targetOccupied: 99, target: { ...target, max_players: null } }).ok).toBe(true)
  })

  it('vaga oferecida muda de categoria sem precisar de vaga (vai para a fila do destino)', () => {
    expect(checkEntryMove({ ...base, entry: { ...pair, entryStatus: 'offered' }, targetOccupied: 16 }).ok).toBe(true)
  })
})

describe('repriceSide', () => {
  it('pago fica pago', () => {
    const paid = { status: 'paid' as const, discountPct: 0, finalPriceCents: 6000 }
    expect(repriceSide(paid, { charged: true, priceCents: 8000 })).toBe(paid)
  })

  it('pendente passa ao preço do destino com o mesmo desconto', () => {
    const pending = { status: 'pending' as const, discountPct: 30, finalPriceCents: 4200 }
    expect(repriceSide(pending, { charged: true, priceCents: 8000 })).toEqual({
      status: 'pending', discountPct: 30, finalPriceCents: 5600,
    })
  })

  it('grátis vira pendente em categoria paga, e o contrário', () => {
    expect(repriceSide({ status: 'free', discountPct: 0, finalPriceCents: 0 }, { charged: true, priceCents: 5000 }))
      .toEqual({ status: 'pending', discountPct: 0, finalPriceCents: 5000 })
    expect(repriceSide({ status: 'pending', discountPct: 0, finalPriceCents: 5000 }, { charged: false, priceCents: 5000 }))
      .toEqual({ status: 'free', discountPct: 0, finalPriceCents: 0 })
  })
})

describe('paidDifferenceNotice', () => {
  const paid = { status: 'paid' as const, discountPct: 0, finalPriceCents: 6000 }
  it('avisa só quando quem pagou foi para outro preço', () => {
    expect(paidDifferenceNotice('Ana', paid, { charged: true, priceCents: 6000 })).toBeNull()
    expect(paidDifferenceNotice('Ana', paid, { charged: true, priceCents: 8000 })).toContain('R$ 80,00')
    expect(paidDifferenceNotice('Ana', { ...paid, status: 'pending' }, { charged: true, priceCents: 8000 })).toBeNull()
  })
})

describe('resolveTargetConflicts', () => {
  const ref = (over: Partial<TargetEntryRef>): TargetEntryRef => ({
    id: 'e', player_id: 'lucas', partner_id: null, entry_status: 'confirmed',
    payment_status: 'free', partner_payment_status: null, ...over,
  })

  it('confirmado no destino trava', () => {
    expect(resolveTargetConflicts(['lucas'], [ref({})]).clash).toEqual({ personId: 'lucas', kind: 'enrolled' })
  })

  it('vaga oferecida ou fila da mesma pessoa é substituída, não trava', () => {
    const offered = ref({ id: 'o', entry_status: 'offered' })
    const waiting = ref({ id: 'w', entry_status: 'waitlist', player_id: 'bia', partner_id: 'lucas' })
    expect(resolveTargetConflicts(['lucas'], [offered])).toEqual({ clash: null, supersede: [offered] })
    expect(resolveTargetConflicts(['lucas', 'bia'], [waiting])).toEqual({ clash: null, supersede: [waiting] })
  })

  it('fila em dupla com alguém de fora trava', () => {
    const waiting = ref({ entry_status: 'waitlist', partner_id: 'caio' })
    expect(resolveTargetConflicts(['lucas'], [waiting]).clash).toEqual({ personId: 'lucas', kind: 'shared_waitlist' })
  })

  it('quem não é desta inscrição é ignorado', () => {
    expect(resolveTargetConflicts(['lucas'], [ref({ player_id: 'outro' })])).toEqual({ clash: null, supersede: [] })
  })
})
