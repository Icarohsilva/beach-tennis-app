// lib/torneios/pairRules.test.ts
import { describe, it, expect } from 'vitest'
import {
  canonicalizePairGenders,
  pairGendersFor,
  pairGendersOf,
  gendersAdmitted,
  requiresKnownGender,
  canEnter,
  canPairUp,
  validateEntry,
  pairGendersLabel,
  entryRuleLabel,
  ALL_PAIR_GENDERS,
  PAIR_PRESETS,
} from './pairRules'
import type { PairGenders } from '@/types'

describe('canonicalizePairGenders', () => {
  it('ordena, dedupa e descarta lixo', () => {
    expect(canonicalizePairGenders(['FF', 'MM', 'MM', 'XX'])).toEqual(['MM', 'FF'])
  })

  it('toda combinação possível de entrada gera um dos 7 conjuntos aceitos pelo CHECK', () => {
    const valid = PAIR_PRESETS.map((p) => JSON.stringify(p.allowed))
    const subsets: string[][] = []
    for (let mask = 0; mask < 8; mask++) {
      const combo: PairGenders[] = []
      if (mask & 1) combo.push('MM')
      if (mask & 2) combo.push('MF')
      if (mask & 4) combo.push('FF')
      subsets.push(combo)
    }
    for (const combo of subsets) {
      const result = canonicalizePairGenders(combo)
      if (combo.length === 0) {
        expect(result).toEqual([])
      } else {
        expect(valid).toContain(JSON.stringify(result))
      }
    }
  })
})

describe('pairGendersFor — mesmo mapa do backfill da migração', () => {
  it('masculino → MM, feminino → FF, misto → MF, livre → todas', () => {
    expect(pairGendersFor('masculino')).toEqual(['MM'])
    expect(pairGendersFor('feminino')).toEqual(['FF'])
    expect(pairGendersFor('misto')).toEqual(['MF'])
    expect(pairGendersFor('livre')).toEqual(['MM', 'MF', 'FF'])
  })
})

describe('pairGendersOf', () => {
  it('MM, FF, MF nos três casos, null quando falta gênero', () => {
    expect(pairGendersOf('M', 'M')).toBe('MM')
    expect(pairGendersOf('F', 'F')).toBe('FF')
    expect(pairGendersOf('M', 'F')).toBe('MF')
    expect(pairGendersOf('F', 'M')).toBe('MF')
    expect(pairGendersOf(null, 'M')).toBeNull()
    expect(pairGendersOf('M', null)).toBeNull()
  })
})

describe('gendersAdmitted / requiresKnownGender', () => {
  it('{MM,MF,FF} admite os dois e não exige gênero conhecido', () => {
    expect(gendersAdmitted(['MM', 'MF', 'FF'])).toEqual({ M: true, F: true })
    expect(requiresKnownGender(['MM', 'MF', 'FF'])).toBe(false)
  })

  it('{MM} só admite M; {FF} só admite F; ambos exigem gênero conhecido', () => {
    expect(gendersAdmitted(['MM'])).toEqual({ M: true, F: false })
    expect(gendersAdmitted(['FF'])).toEqual({ M: false, F: true })
    expect(requiresKnownGender(['MM'])).toBe(true)
    expect(requiresKnownGender(['FF'])).toBe(true)
  })

  it('{MF,FF} (sem dupla masculina) admite os dois gêneros individualmente, mas ainda é restrição', () => {
    expect(gendersAdmitted(['MF', 'FF'])).toEqual({ M: true, F: true })
    // É restrição (não é o conjunto cheio), então gênero nulo continua indecidível:
    // um M só cabe pareado como MF, nunca como FF — sem saber o gênero não dá pra
    // confirmar a inscrição.
    expect(requiresKnownGender(['MF', 'FF'])).toBe(true)
  })

  it('só o conjunto cheio {MM,MF,FF} dispensa gênero conhecido', () => {
    expect(requiresKnownGender(['MM', 'MF', 'FF'])).toBe(false)
    expect(requiresKnownGender(['MM', 'MF'])).toBe(true)
    expect(requiresKnownGender(['MM', 'FF'])).toBe(true)
  })
})

describe('canEnter', () => {
  it('{MM} barra F; {FF} barra M', () => {
    expect(canEnter('F', ['MM']).ok).toBe(false)
    expect(canEnter('M', ['MM']).ok).toBe(true)
    expect(canEnter('M', ['FF']).ok).toBe(false)
    expect(canEnter('F', ['FF']).ok).toBe(true)
  })

  it('{MM,MF,FF} aceita gênero nulo', () => {
    expect(canEnter(null, ['MM', 'MF', 'FF']).ok).toBe(true)
  })

  it('{MF,FF} recusa gênero nulo com a mensagem do perfil — é restrição, ainda que admita os dois gêneros', () => {
    const v = canEnter(null, ['MF', 'FF'])
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/perfil/i)
  })
})

describe('canPairUp — o requisito literal do usuário: "sem dupla masculina"', () => {
  const semDuplaMasculina: PairGenders[] = ['MF', 'FF']

  it('homem + homem é barrado com a mensagem certa', () => {
    const v = canPairUp('M', 'M', semDuplaMasculina)
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('Neste torneio não é permitida dupla de dois homens.')
  })

  it('mulher + mulher é aceito', () => {
    expect(canPairUp('F', 'F', semDuplaMasculina).ok).toBe(true)
  })

  it('homem + mulher é aceito', () => {
    expect(canPairUp('M', 'F', semDuplaMasculina).ok).toBe(true)
    expect(canPairUp('F', 'M', semDuplaMasculina).ok).toBe(true)
  })

  it('torneio {FF}: homem + mulher é recusado (torneio exclusivamente feminino)', () => {
    const v = canPairUp('F', 'M', ['FF'])
    expect(v.ok).toBe(false)
  })

  it('torneio {MM}: mulher + homem é recusado — BUG A: hoje o parceiro nunca é conferido', () => {
    // registerForTournament só chamava canRegister() para quem clicou; um
    // torneio masculino aceitava dupla homem+mulher desde que quem se
    // inscreveu fosse homem. Aqui os dois lados são conferidos.
    const v = canPairUp('M', 'F', ['MM'])
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('Neste torneio só é permitida dupla masculina (2 homens).')
  })

  it('{MM,FF} (mesmo gênero): mista é recusada', () => {
    const v = canPairUp('M', 'F', ['MM', 'FF'])
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('Neste torneio a dupla tem de ser do mesmo gênero.')
  })

  it('{MF} exclusivo: mensagem específica de mista', () => {
    const v = canPairUp('M', 'M', ['MF'])
    expect(v.reason).toBe('Categoria mista exige uma dupla com 1 homem e 1 mulher.')
  })

  it('parceiro sem gênero: mensagem própria, não a do meu perfil', () => {
    const v = canPairUp('M', null, ['MM'])
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/parceiro/i)
  })

  it('eu sem gênero: mensagem do meu perfil', () => {
    const v = canPairUp(null, 'M', ['MM'])
    expect(v.reason).toMatch(/^Complete seu gênero/)
  })
})

describe('validateEntry', () => {
  it('individual nunca exige parceiro, só a união das letras', () => {
    expect(validateEntry({ participantType: 'individual', allowed: ['MM'], myGender: 'M' }).ok).toBe(true)
    expect(validateEntry({ participantType: 'individual', allowed: ['MM'], myGender: 'F' }).ok).toBe(false)
  })

  it('dupla_revezando idem — par sorteado a cada rodada não é exigível', () => {
    expect(
      validateEntry({ participantType: 'dupla_revezando', allowed: ['MF', 'FF'], myGender: 'M' }).ok,
    ).toBe(true)
  })

  it('dupla_fixa sem partnerGender informado recusa com a mensagem de selecionar parceiro', () => {
    const v = validateEntry({ participantType: 'dupla_fixa', allowed: ['MM', 'MF', 'FF'], myGender: 'M' })
    expect(v.ok).toBe(false)
    expect(v.reason).toBe('Selecione um parceiro para dupla fixa.')
  })

  it('dupla_fixa com os dois gêneros roda canPairUp', () => {
    const v = validateEntry({
      participantType: 'dupla_fixa',
      allowed: ['MF', 'FF'],
      myGender: 'M',
      partnerGender: 'M',
    })
    expect(v.ok).toBe(false)
  })
})

describe('pairGendersLabel / entryRuleLabel', () => {
  it('cobre os 7 presets', () => {
    for (const preset of PAIR_PRESETS) {
      expect(pairGendersLabel(preset.allowed)).toBe(preset.label)
    }
  })

  it('entryRuleLabel é nulo em {MM,MF,FF} — não pastilhar "qualquer formação"', () => {
    expect(entryRuleLabel('dupla_fixa', ['MM', 'MF', 'FF'])).toBeNull()
  })

  it('entryRuleLabel é nulo fora de dupla_fixa', () => {
    expect(entryRuleLabel('individual', ['MM'])).toBeNull()
    expect(entryRuleLabel('dupla_revezando', ['MM'])).toBeNull()
  })

  it('entryRuleLabel mostra o preset em dupla_fixa restrita', () => {
    expect(entryRuleLabel('dupla_fixa', ['MF', 'FF'])).toBe('Sem dupla masculina')
  })
})

describe('ALL_PAIR_GENDERS', () => {
  it('está em ordem canônica', () => {
    expect(ALL_PAIR_GENDERS).toEqual(['MM', 'MF', 'FF'])
  })
})
