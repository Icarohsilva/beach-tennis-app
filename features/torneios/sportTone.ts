// features/torneios/sportTone.ts
// As classes Tailwind de cada cor de modalidade.
//
// Mora em features/ e não em lib/ por um motivo prático: o `content` do
// tailwind.config.ts varre app/, components/ e features/ — lib/ fica de fora,
// que é o certo (lib é lógica pura). Classe escrita lá não entra no CSS
// gerado e a pastilha renderiza sem cor nenhuma.
//
// Os nomes vão escritos por extenso porque a varredura do Tailwind é textual:
// `bg-${tone}-500/10` montado em runtime nunca é encontrado.
import type { SportTone } from '@/lib/torneios/sportProfile'

export interface ToneClasses {
  /** Pastilha do esporte: borda + fundo + texto. */
  pill: string
  /** Ponto sólido, para marcadores pequenos. */
  dot: string
  /** Véu de fundo do card, bem discreto. */
  glow: string
}

export const TONE_CLASSES: Record<SportTone, ToneClasses> = {
  amber:   { pill: 'border-amber-400/40 bg-amber-500/20 text-amber-200',       dot: 'bg-amber-400',   glow: 'bg-amber-500/10' },
  emerald: { pill: 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200', dot: 'bg-emerald-400', glow: 'bg-emerald-500/10' },
  lime:    { pill: 'border-lime-400/40 bg-lime-500/20 text-lime-200',          dot: 'bg-lime-400',    glow: 'bg-lime-500/10' },
  cyan:    { pill: 'border-cyan-400/40 bg-cyan-500/20 text-cyan-200',          dot: 'bg-cyan-400',    glow: 'bg-cyan-500/10' },
  green:   { pill: 'border-green-400/40 bg-green-500/20 text-green-200',       dot: 'bg-green-400',   glow: 'bg-green-500/10' },
  teal:    { pill: 'border-teal-400/40 bg-teal-500/20 text-teal-200',          dot: 'bg-teal-400',    glow: 'bg-teal-500/10' },
  red:     { pill: 'border-red-400/40 bg-red-500/20 text-red-200',             dot: 'bg-red-400',     glow: 'bg-red-500/10' },
  orange:  { pill: 'border-orange-400/40 bg-orange-500/20 text-orange-200',    dot: 'bg-orange-400',  glow: 'bg-orange-500/10' },
  violet:  { pill: 'border-violet-400/40 bg-violet-500/20 text-violet-200',    dot: 'bg-violet-400',  glow: 'bg-violet-500/10' },
  purple:  { pill: 'border-purple-400/40 bg-purple-500/20 text-purple-200',    dot: 'bg-purple-400',  glow: 'bg-purple-500/10' },
  rose:    { pill: 'border-rose-400/40 bg-rose-500/20 text-rose-200',          dot: 'bg-rose-400',    glow: 'bg-rose-500/10' },
  blue:    { pill: 'border-blue-400/40 bg-blue-500/20 text-blue-200',          dot: 'bg-blue-400',    glow: 'bg-blue-500/10' },
  indigo:  { pill: 'border-indigo-400/40 bg-indigo-500/20 text-indigo-200',    dot: 'bg-indigo-400',  glow: 'bg-indigo-500/10' },
  yellow:  { pill: 'border-yellow-400/40 bg-yellow-500/20 text-yellow-200',    dot: 'bg-yellow-400',  glow: 'bg-yellow-500/10' },
  pink:    { pill: 'border-pink-400/40 bg-pink-500/20 text-pink-200',          dot: 'bg-pink-400',    glow: 'bg-pink-500/10' },
  slate:   { pill: 'border-slate-400/40 bg-slate-500/20 text-slate-200',       dot: 'bg-slate-400',   glow: 'bg-slate-500/10' },
}

export function toneClasses(tone: SportTone): ToneClasses {
  return TONE_CLASSES[tone] ?? TONE_CLASSES.slate
}
