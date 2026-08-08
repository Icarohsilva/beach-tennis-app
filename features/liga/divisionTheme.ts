// features/liga/divisionTheme.ts
// Identidade visual de cada divisão.
//
// A divisão precisa PARECER diferente, não só se chamar diferente: é ela que dá a
// sensação de progresso quando o aluno sobe, e um ranking todo laranja não entrega
// isso. As classes são literais (nunca montadas por concatenação) porque o Tailwind
// varre o código fonte — classe construída em runtime não entra no CSS final.
import type { LigaDivision } from '@/types'

export interface DivisionTheme {
  label: string
  short: string
  /** Gradiente do hero. */
  gradient: string
  /** Cor do texto de apoio sobre o gradiente. */
  accent: string
  /** Anel/borda da pastilha do brasão. */
  ring: string
  /** Cor sólida para pontos e destaques fora do hero. */
  solid: string
}

export const DIVISION_THEME: Record<LigaDivision, DivisionTheme> = {
  bronze: {
    label: 'Divisão Bronze',
    short: 'Bronze',
    // Cobre queimado, puxado para o marrom: precisa se distinguir do laranja da marca,
    // que aparece em todo o resto da tela.
    gradient: 'from-orange-800 via-stone-800 to-stone-950',
    accent: 'text-orange-200/70',
    ring: 'border-orange-300/25 bg-orange-200/10',
    solid: 'text-orange-400',
  },
  prata: {
    label: 'Divisão Prata',
    short: 'Prata',
    // Cinza metálico. Escuro o bastante para o texto branco ter contraste.
    gradient: 'from-slate-500 via-slate-700 to-slate-950',
    accent: 'text-slate-200/80',
    ring: 'border-slate-200/30 bg-slate-100/10',
    solid: 'text-slate-300',
  },
  ouro: {
    label: 'Divisão Ouro',
    short: 'Ouro',
    // Dourado puxado para o amarelo, não para o âmbar: com âmbar o hero ficava idêntico
    // ao laranja da marca e subir de Bronze para Ouro não mudava nada na tela. Escuro o
    // bastante para o texto branco continuar legível em cima.
    gradient: 'from-yellow-600 via-amber-700 to-yellow-950',
    accent: 'text-yellow-100/85',
    ring: 'border-yellow-200/40 bg-yellow-100/15',
    solid: 'text-yellow-400',
  },
  diamante: {
    label: 'Divisão Diamante',
    short: 'Diamante',
    gradient: 'from-cyan-500 via-sky-700 to-indigo-950',
    accent: 'text-cyan-100/85',
    ring: 'border-cyan-200/40 bg-cyan-100/15',
    solid: 'text-cyan-300',
  },
}

/** Ícone lucide do brasão de cada divisão. */
export const DIVISION_ICON: Record<LigaDivision, string> = {
  bronze: 'Shield',
  prata: 'Shield',
  ouro: 'Trophy',
  diamante: 'Gem',
}
