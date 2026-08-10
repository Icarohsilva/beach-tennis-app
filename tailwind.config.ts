// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './features/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // O app é mobile-first, mas o menor breakpoint do Tailwind é `sm` (640px):
      // não havia como dizer "só em celular pequeno", e todo utilitário sem prefixo
      // valia igual em 320px e em 639px. `xs` fica logo acima do iPhone 11 (375px),
      // então `grid-cols-2 xs:grid-cols-3` dá 2 colunas no aparelho do dia a dia e
      // 3 só onde caibam de fato.
      screens: {
        xs: '400px',
      },
      spacing: {
        // `pb-safe` era usada na BottomNav e em modais bottom-sheet, mas nunca
        // existiu: sem plugin e sem este token o Tailwind não emitia nada. Depende
        // de `viewportFit: 'cover'` em app/layout.tsx para resolver > 0 no iOS.
        safe: 'env(safe-area-inset-bottom)',
      },
      colors: {
        brand: {
          50:  'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
        surface: {
          DEFAULT: '#0c1220',
          card:    '#151e31',
          border:  '#26334d',
        },
      },
    },
  },
  plugins: [],
}

export default config
