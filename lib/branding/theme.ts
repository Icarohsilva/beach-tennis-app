// lib/branding/theme.ts
// Converte a cor de marca da academia em CSS custom properties (triplas RGB) que
// alimentam os tokens brand-* do Tailwind (ver tailwind.config.ts + globals.css).
// Escalas pré-computadas (mapa cor→escala) — mais previsível que derivação algorítmica.
// Cada escala usa uma família Tailwind ancorando a cor escolhida no tom 500.
import { DEFAULT_BRAND_COLOR, isAllowedBrandColor } from './palette'

type Scale = readonly [string, string, string, string, string, string, string, string, string, string]
//             50      100     200     300     400     500     600     700     800     900

// chave = hex do tom 500 (a cor da allowlist). Índice 5 sempre === a chave.
const SCALES: Record<string, Scale> = {
  '#f97316': ['#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12'],
  '#7c3aed': ['#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95', '#2e1065'],
  '#2563eb': ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a', '#172554'],
  '#059669': ['#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b', '#022c22'],
  '#dc2626': ['#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d', '#450a0a'],
  '#db2777': ['#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843', '#500724'],
  '#0891b2': ['#cffafe', '#a5f3fc', '#67e8f9', '#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63', '#083344'],
  '#ca8a04': ['#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12', '#422006'],
}

const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const

// "#7c3aed" → "124 58 237"
function hexToTriplet(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r} ${g} ${b}`
}

export function accentVars(color: unknown): Record<string, string> {
  const key = isAllowedBrandColor(color) ? (color as string).toLowerCase() : DEFAULT_BRAND_COLOR
  const scale = SCALES[key] ?? SCALES[DEFAULT_BRAND_COLOR]
  const vars: Record<string, string> = {}
  STOPS.forEach((stop, i) => {
    vars[`--brand-${stop}`] = hexToTriplet(scale[i])
  })
  return vars
}
