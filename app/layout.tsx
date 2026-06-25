// app/layout.tsx
import type { Metadata, Viewport } from 'next'
import { Inter, Sora } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const sora = Sora({ subsets: ['latin'], weight: ['400', '600', '700', '800'], variable: '--font-sora' })

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'ArenaHub — Gestão para arenas e academias de esporte',
  description:
    'Aulas, turmas, créditos, check-in e pagamentos para arenas de beach tennis, padel, futevôlei e mais. 1º mês grátis.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ArenaHub',
  },
  openGraph: {
    title: 'ArenaHub — Gestão para arenas e academias de esporte',
    description:
      'Aulas, turmas, créditos, check-in e pagamentos para arenas de beach tennis, padel, futevôlei e mais. 1º mês grátis.',
    url: SITE_URL,
    siteName: 'ArenaHub',
    images: ['/og.png'],
    locale: 'pt_BR',
    type: 'website',
  },
  // Card grande no X/Twitter — usado em campanhas e ao colar o link na rede.
  twitter: {
    card: 'summary_large_image',
    title: 'ArenaHub — Gestão para arenas e academias de esporte',
    description:
      'Aulas, turmas, créditos, check-in e pagamentos para arenas de beach tennis, padel, futevôlei e mais. 1º mês grátis.',
    images: ['/og.png'],
  },
}

export const viewport: Viewport = {
  themeColor: '#ea580c',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.className} ${inter.variable} ${sora.variable}`}>{children}</body>
    </html>
  )
}
