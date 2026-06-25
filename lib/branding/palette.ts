// lib/branding/palette.ts
// Allowlist curada de cores de marca por academia. Cada hex é o tom "500" (cor
// principal de botões/links). Validada no servidor — nunca um valor arbitrário.
// Todas têm contraste garantido no tema escuro e com texto branco.

export const ALLOWED_BRAND_COLORS = [
  '#f97316', // laranja (default ArenaHub)
  '#7c3aed', // violeta
  '#2563eb', // azul
  '#059669', // esmeralda
  '#dc2626', // vermelho
  '#db2777', // rosa
  '#0891b2', // ciano
  '#ca8a04', // âmbar
] as const

export type BrandColor = (typeof ALLOWED_BRAND_COLORS)[number]

export const DEFAULT_BRAND_COLOR: BrandColor = '#f97316'

const ALLOWED_SET = new Set<string>(ALLOWED_BRAND_COLORS)

export function isAllowedBrandColor(color: unknown): color is BrandColor {
  return typeof color === 'string' && ALLOWED_SET.has(color.toLowerCase())
}
