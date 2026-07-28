'use client'
// app/(auth)/nova-senha/LinkInvalido.tsx
// Cliente porque o motivo pode vir no FRAGMENTO da URL (#error_code=otp_expired),
// que nunca chega ao servidor. Isso acontece com os links do formato antigo (PKCE):
// quem recusa o token é o /auth/v1/verify do Supabase, antes de bater aqui.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'

const MENSAGENS: Record<string, string> = {
  expirado:
    'Este link já foi usado ou expirou. Só o link do e-mail MAIS RECENTE funciona — pedir um novo invalida os anteriores.',
  outro_navegador:
    'Abra o link no mesmo navegador em que você pediu a recuperação. Se não der, peça um link novo por aqui.',
  invalido: 'Este link de recuperação é inválido.',
  sem_token: 'Este link de recuperação veio incompleto.',
  sessao: 'Sua janela para definir a nova senha expirou. Peça um link novo.',
}
const PADRAO = 'Este link de recuperação é inválido ou expirou.'

export function LinkInvalido({ motivo }: { motivo?: string }) {
  const [mensagem, setMensagem] = useState(MENSAGENS[motivo ?? ''] ?? PADRAO)

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    if (hash.get('error_code') === 'otp_expired') setMensagem(MENSAGENS.expirado)
  }, [])

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <p className="text-red-400 text-sm text-center mb-4">{mensagem}</p>
      <Link href="/recuperar-senha" className="block text-center text-brand-500 text-sm hover:underline">
        Solicitar um novo link
      </Link>
    </Card>
  )
}
