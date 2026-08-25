import { describe, it, expect } from 'vitest'
import { SPORTS } from '@/lib/arenas/sports'
import {
  LEVEL_ORDER,
  categoryLabel,
  competitorCountLabel,
  competitorNoun,
  competitorUnit,
  formatLabel,
  isKnownSport,
  levelLabel,
  participantLabel,
  sportChip,
  sportFamily,
  sportTone,
} from './sportProfile'

describe('cobertura das modalidades', () => {
  // A promessa do módulo é "todos os esportes que a plataforma tem hoje". Se
  // alguém acrescentar um slug em lib/arenas/sports.ts sem perfil aqui, este
  // teste é quem avisa.
  it('todo esporte do cardápio tem família e cor próprias', () => {
    for (const s of SPORTS) {
      expect(sportChip(s.slug).label, s.slug).toBe(s.label)
      expect(sportTone(s.slug), s.slug).toBeTruthy()
      expect(['raquete', 'coletivo', 'individual']).toContain(sportFamily(s.slug))
    }
  })

  it('não repete cor entre modalidades do cardápio', () => {
    // As classes que estas chaves viram são conferidas em
    // features/torneios/sportTone.test.ts — aqui só a chave, que é o que lib
    // conhece.
    const tones = SPORTS.map((s) => sportTone(s.slug))
    expect(new Set(tones).size).toBe(SPORTS.length)
  })

  it('esporte desconhecido ou custom não quebra — cai no neutro', () => {
    expect(sportChip('custom:Frescobol').label).toBe('Frescobol')
    expect(sportChip('custom:Frescobol').emoji).toBe('🏅')
    expect(sportTone('slug_que_nao_existe')).toBe('slate')
    expect(sportChip(null).label).toBe('Modalidade')
  })

  it('isKnownSport aceita cardápio e custom, recusa slug solto', () => {
    expect(isKnownSport('padel')).toBe(true)
    expect(isKnownSport('custom:Frescobol')).toBe(true)
    expect(isKnownSport('quadribol')).toBe(false)
  })
})

describe('competitorUnit', () => {
  it('só a dupla fixa ocupa a vaga como dupla', () => {
    expect(competitorUnit('beach_tennis', 'dupla_fixa')).toBe('dupla')
    expect(competitorUnit('tenis', 'individual')).toBe('atleta')
  })

  it('no revezando cada inscrição é um atleta, não uma dupla', () => {
    // A vaga é individual e a dupla é sorteada por rodada: "Super 8" são 8
    // atletas. Contar duplas aqui mostraria metade das vagas ocupadas.
    expect(competitorUnit('padel', 'dupla_revezando')).toBe('atleta')
    expect(competitorCountLabel(8, 'beach_tennis', 'dupla_revezando')).toBe('8 atletas')
    expect(competitorCountLabel(8, 'beach_tennis', 'dupla_fixa')).toBe('8 duplas')
  })

  it('esporte individual sem dupla chama de atleta', () => {
    expect(competitorUnit('crossfit', 'individual')).toBe('atleta')
    expect(competitorUnit('natacao', 'individual')).toBe('atleta')
  })

  it('esporte individual inscrito em dupla respeita a dupla', () => {
    // Crossfit em dupla existe (WOD de casal) — o participant_type manda.
    expect(competitorUnit('crossfit', 'dupla_fixa')).toBe('dupla')
  })

  it('coletivo é sempre time, mesmo com inscrição individual', () => {
    expect(competitorUnit('futebol', 'individual')).toBe('time')
    expect(competitorUnit('basquete', 'dupla_fixa')).toBe('time')
  })
})

describe('rótulos de contagem', () => {
  it('concorda singular e plural', () => {
    expect(competitorCountLabel(1, 'beach_tennis', 'dupla_fixa')).toBe('1 dupla')
    expect(competitorCountLabel(8, 'beach_tennis', 'dupla_fixa')).toBe('8 duplas')
    expect(competitorCountLabel(1, 'crossfit', 'individual')).toBe('1 atleta')
    expect(competitorCountLabel(12, 'crossfit', 'individual')).toBe('12 atletas')
    expect(competitorCountLabel(4, 'futebol', 'individual')).toBe('4 times')
  })

  it('zero usa plural', () => {
    expect(competitorCountLabel(0, 'padel', 'dupla_fixa')).toBe('0 duplas')
  })

  it('competitorNoun devolve o substantivo isolado', () => {
    expect(competitorNoun('padel', 'dupla_fixa')).toBe('dupla')
    expect(competitorNoun('padel', 'dupla_fixa', true)).toBe('duplas')
    expect(competitorNoun('yoga', 'individual', true)).toBe('atletas')
  })
})

describe('participantLabel', () => {
  it('distingue dupla fixa de sorteada', () => {
    expect(participantLabel('beach_tennis', 'dupla_fixa')).toBe('Dupla fixa')
    expect(participantLabel('beach_tennis', 'dupla_revezando')).toBe('Dupla sorteada')
  })

  it('descreve a dinâmica mesmo quando a vaga é individual', () => {
    // No revezando a unidade de vaga é o atleta, mas o aluno precisa saber que
    // vai jogar com parceiro sorteado — os dois fatos convivem.
    expect(competitorUnit('padel', 'dupla_revezando')).toBe('atleta')
    expect(participantLabel('padel', 'dupla_revezando')).toBe('Dupla sorteada')
  })

  it('some onde não existe dupla', () => {
    expect(participantLabel('crossfit', 'individual')).toBeNull()
    expect(participantLabel('futebol', 'individual')).toBeNull()
    expect(participantLabel('futebol', 'dupla_fixa')).toBeNull()
  })
})

describe('levelLabel', () => {
  it('usa a escala de letras nos esportes de raquete', () => {
    expect(levelLabel('A', 'beach_tennis')).toBe('Nível A')
    expect(levelLabel('D', 'padel')).toBe('Nível D')
    expect(levelLabel('iniciante', 'tenis')).toBe('Iniciante')
  })

  it('traduz a letra em palavra fora da raquete', () => {
    expect(levelLabel('A', 'crossfit')).toBe('Elite')
    expect(levelLabel('B', 'crossfit')).toBe('Avançado')
    expect(levelLabel('C', 'natacao')).toBe('Intermediário')
    expect(levelLabel('D', 'yoga')).toBe('Básico')
    expect(levelLabel('iniciante', 'yoga')).toBe('Iniciante')
  })

  it('cada nível tem rótulo distinto nas duas escalas', () => {
    for (const sport of ['beach_tennis', 'crossfit']) {
      const labels = LEVEL_ORDER.map((l) => levelLabel(l, sport))
      expect(new Set(labels).size, sport).toBe(LEVEL_ORDER.length)
    }
  })
})

describe('formatLabel', () => {
  it('americano com teto vira Super N — o nome que o mercado usa', () => {
    expect(formatLabel('americano', 8)).toBe('Super 8')
    expect(formatLabel('americano', 12)).toBe('Super 12')
    expect(formatLabel('americano', 16)).toBe('Super 16')
  })

  it('americano sem teto usa o nome do formato', () => {
    expect(formatLabel('americano', null)).toBe('Super')
    expect(formatLabel('americano', 0)).toBe('Super')
  })

  it('formatos não-americanos nunca viram Super N', () => {
    expect(formatLabel('eliminatoria', 16)).toBe('Eliminatória')
    expect(formatLabel('round_robin', 8)).toBe('Todos contra todos')
    expect(formatLabel('ranking', 8)).toBe('Ranking')
  })

  it('linha legada super8 continua legível', () => {
    expect(formatLabel('super8', null)).toBe('Super 8')
    expect(formatLabel('super8', 10)).toBe('Super 10')
  })

  it('formato ausente cai no padrão do banco', () => {
    expect(formatLabel(null, null)).toBe('Super')
  })
})

describe('categoryLabel', () => {
  it('capitaliza as categorias conhecidas', () => {
    expect(categoryLabel('masculino')).toBe('Masculino')
    expect(categoryLabel('misto')).toBe('Misto')
    expect(categoryLabel('livre')).toBe('Livre')
  })

  it('devolve null para ausente ou desconhecida', () => {
    expect(categoryLabel(null)).toBeNull()
    expect(categoryLabel('sub18')).toBeNull()
  })
})
