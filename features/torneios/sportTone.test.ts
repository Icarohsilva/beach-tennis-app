import { describe, it, expect } from 'vitest'
import { SPORTS } from '@/lib/arenas/sports'
import { sportTone } from '@/lib/torneios/sportProfile'
import { TONE_CLASSES, toneClasses } from './sportTone'

// A cor da modalidade nasce em lib/ (a chave) e vira classe aqui. Estes testes
// existem para os dois lados não se separarem sem ninguém perceber — foi
// exatamente esse tipo de descolamento que fez a pastilha renderizar sem cor.
describe('sportTone ↔ TONE_CLASSES', () => {
  it('toda modalidade do cardápio resolve para uma cor definida', () => {
    for (const s of SPORTS) {
      const tone = sportTone(s.slug)
      expect(TONE_CLASSES[tone], `${s.slug} -> ${tone}`).toBeDefined()
    }
  })

  it('modalidades diferentes recebem cores diferentes', () => {
    const pills = SPORTS.map((s) => toneClasses(sportTone(s.slug)).pill)
    expect(new Set(pills).size).toBe(SPORTS.length)
  })

  it('esporte desconhecido cai no neutro em vez de ficar sem classe', () => {
    expect(toneClasses(sportTone('quadribol'))).toBe(TONE_CLASSES.slate)
    expect(toneClasses(sportTone('custom:Frescobol'))).toBe(TONE_CLASSES.slate)
  })

  it('as classes são literais completas, não montadas em runtime', () => {
    // O Tailwind varre o código como texto: `bg-${tone}-500/20` nunca entra no
    // CSS. Se um dia alguém trocar o mapa por template string, isto quebra.
    for (const [tone, classes] of Object.entries(TONE_CLASSES)) {
      expect(classes.pill, tone).toContain(`bg-${tone}-`)
      expect(classes.pill, tone).toContain(`text-${tone}-`)
      expect(classes.pill, tone).toContain(`border-${tone}-`)
      expect(classes.pill, tone).not.toContain('${')
    }
  })
})
