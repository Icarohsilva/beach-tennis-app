'use client'
// components/ui/CookieBanner.tsx
// Aviso informativo, não um consent manager com opt-in granular: hoje o ArenaHub usa
// SOMENTE o cookie de sessão do Supabase Auth (estritamente necessário — LGPD art. 6º,
// VI exige transparência, não opt-in, quando não há cookie opcional). Se um dia entrar
// qualquer analytics/pixel de terceiro, ESTE componente deve ser trocado por um consent
// manager real com opt-in ANTES do script carregar — não apenas atualizado.
import { useEffect, useState } from 'react'
import Link from 'next/link'

const STORAGE_KEY = 'arenahub_cookie_notice_dismissed_v1'

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!window.localStorage.getItem(STORAGE_KEY)) setVisible(true)
  }, [])

  if (!visible) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] border-t border-surface-border bg-surface-card/95 backdrop-blur px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="text-xs text-slate-300 text-center sm:text-left">
          Usamos apenas cookies essenciais para manter você conectado. Não usamos cookies de
          rastreamento ou publicidade. Saiba mais na{' '}
          <Link href="/legal/politica-cookies" className="underline text-brand-400">
            Política de Cookies
          </Link>
          .
        </p>
        <button
          onClick={() => {
            window.localStorage.setItem(STORAGE_KEY, '1')
            setVisible(false)
          }}
          className="shrink-0 rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition-colors"
        >
          Entendi
        </button>
      </div>
    </div>
  )
}
