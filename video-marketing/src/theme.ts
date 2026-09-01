// Identidade visual do vídeo — espelha tailwind.config.ts + app/globals.css.
// Se a marca mudar no app, mude aqui: nenhum componente do vídeo tem cor solta.
export const cores = {
  fundo: '#0c1220',        // bg-surface
  fundoCard: '#151e31',    // bg-surface-card
  borda: '#26334d',        // border-surface-border
  marca: '#f97316',        // brand-500
  marcaEscura: '#ea580c',  // brand-600
  marcaProfunda: '#9a3412',// brand-800
  areia: '#fbbf24',
  texto: '#f8fafc',
  textoSuave: '#94a3b8',
} as const

// A quadra de beach tennis é o motivo gráfico da abertura: é o que diferencia
// de qualquer abertura genérica de SaaS.
export const QUADRA = {
  linha: 'rgba(249, 146, 60, 0.85)',
  linhaFraca: 'rgba(249, 115, 22, 0.30)',
} as const
