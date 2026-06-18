// app/(auth)/nova-senha/page.tsx
// Destino do link de recuperação de senha. O createBrowserClient (@supabase/ssr,
// fluxo PKCE) detecta o ?code na URL e estabelece a sessão de recuperação
// automaticamente ao carregar. Aqui o usuário define a nova senha via updateUser.
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import Link from 'next/link'

export default function NovaSenhaPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  // linkInvalido: o Supabase volta com #error=...&error_code=otp_expired no hash
  // quando o link expirou ou já foi usado.
  const [linkInvalido, setLinkInvalido] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('error') || hash.includes('otp_expired')) {
      setLinkInvalido(true)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      // Sem sessão de recuperação válida (link expirado/inválido) o updateUser falha.
      setError('Não foi possível alterar a senha. O link pode ter expirado — solicite um novo.')
      setLinkInvalido(true)
      setLoading(false)
      return
    }
    setDone(true)
    setLoading(false)
  }

  if (done) {
    return (
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <p className="text-green-400 text-sm text-center mb-4">
          Senha alterada com sucesso!
        </p>
        <Link href="/login" className="block text-center text-brand-500 text-sm hover:underline">
          Ir para o login
        </Link>
      </Card>
    )
  }

  if (linkInvalido) {
    return (
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <p className="text-red-400 text-sm text-center mb-4">
          Este link de recuperação é inválido ou expirou.
        </p>
        <Link href="/recuperar-senha" className="block text-center text-brand-500 text-sm hover:underline">
          Solicitar um novo link
        </Link>
      </Card>
    )
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-6">Definir nova senha</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Nova senha"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Input
          label="Confirmar nova senha"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">
          Salvar nova senha
        </Button>
      </form>
    </Card>
  )
}
