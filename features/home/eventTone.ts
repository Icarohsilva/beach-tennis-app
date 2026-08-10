// features/home/eventTone.ts
// Cor de cada tipo de item da agenda.
//
// Mora em `features/` e não em `lib/` de propósito: o Tailwind só varre
// app/, components/ e features/. Classe escrita em lib/ não entra no CSS
// gerado e o item sai sem cor nenhuma em produção — já aconteceu com as cores
// de modalidade dos torneios.
import type { ArenaEventKind } from '@/lib/home/arenaAgenda'

export interface EventTone {
  /** Pastilha/ícone. */
  chip: string
  /** Bolinha no calendário e na faixa da semana. */
  dot: string
  /** Texto de apoio. */
  text: string
}

const TONES: Record<ArenaEventKind, EventTone> = {
  aula: {
    chip: 'bg-brand-500/15 text-brand-300 border-brand-500/30',
    dot: 'bg-brand-400',
    text: 'text-brand-300',
  },
  torneio: {
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
  },
  dayuse: {
    chip: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    dot: 'bg-sky-400',
    text: 'text-sky-300',
  },
}

export function eventTone(kind: ArenaEventKind): EventTone {
  return TONES[kind]
}
