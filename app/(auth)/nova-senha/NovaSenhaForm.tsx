'use client'
// app/(auth)/nova-senha/NovaSenhaForm.tsx
// Só é renderizado depois que /nova-senha/confirmar validou o token e gravou a sessão.
// Mostra de qual conta é a senha que está sendo trocada: se o navegador tinha uma
// sessão antiga, o usuário precisa ver isso antes de digitar.
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { RECOVERY_COOKIE } from '@/lib/auth/sessionCookies'
import { mensagemErroSenha } from '@/lib/auth/authErrors'

export function NovaSenhaForm({ email }: { email: string }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

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
    const { error: erroUpdate } = await supabase.auth.updateUser({ password })
    if (erroUpdate) {
      setError(mensagemErroSenha(erroUpdate.code))
      setLoading(false)
      return
    }
    // Consome o marcador: a janela de recuperação acabou. Sem isso, um F5 traria o
    // formulário de volta em cima de uma sessão que não é mais de recuperação.
    document.cookie = `${RECOVERY_COOKIE}=; Max-Age=0; path=/`
    setDone(true)
    setLoading(false)
  }

  if (done) {
    return (
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <p className="text-green-400 text-sm text-center mb-4">Senha alterada com sucesso!</p>
        <Link href="/login" className="block text-center text-brand-500 text-sm hover:underline">
          Ir para o login
        </Link>
      </Card>
    )
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-1">Definir nova senha</h2>
      <p className="text-sm text-slate-400 mb-6">
        Conta: <span className="text-slate-200">{email}</span>
      </p>
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
