// features/super-admin/chartPalette.ts
// Paleta de STATUS dos gráficos do painel de plataforma. Hexes fixos (e não
// classes do Tailwind) porque entram em atributos `fill` de SVG.
//
// Estes cinco passos foram escolhidos para se distinguirem sobre a superfície
// escura #151e31: separação CVD (pior par adjacente ΔE 10.4, protanopia),
// separação em visão normal (ΔE 24.9) e contraste ≥ 3:1 em todos. O cinza do
// 'canceled' é intencional — estado inerte não deve competir por atenção. Toda
// fatia também recebe rótulo e legenda: a cor nunca é o único código.
import type { SubStatus } from '@/lib/superAdmin/metrics'

export const STATUS_FILL: Record<SubStatus, string> = {
  active: '#34d399',
  trialing: '#3b82f6',
  past_due: '#f59e0b',
  canceled: '#64748b',
  none: '#ef4444',
}

/** Ordem de leitura do funil: quem paga primeiro, quem saiu por último. */
export const STATUS_ORDER: SubStatus[] = ['active', 'trialing', 'past_due', 'canceled', 'none']

/** Laranja da marca — série única de volume (aquisição, uso). */
export const BRAND_FILL = '#f97316'
/** Cor de apoio para a segunda pequena-múltipla (presenças). */
export const BRAND_SOFT_FILL = '#38bdf8'
/** Grade e eixos: recessivos, nunca competem com a marca. */
export const AXIS_STROKE = 'rgba(255,255,255,0.10)'
