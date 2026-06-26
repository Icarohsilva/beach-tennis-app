// app/(auth)/definir-senha/page.tsx
// Troca FORÇADA de senha no 1º login (aluno criado pelo admin com senha temporária).
// Distinta da /nova-senha (fluxo de link de recuperação PKCE). Aqui o usuário JÁ está
// logado: define a nova senha via updateUser e limpa must_change_password.
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { clearMustChangePassword } from '@/features/auth/actions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

export default function DefinirSenhaPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
    const { error: updErr } = await supabase.auth.updateUser({ password })
    if (updErr) {
      setError('Não foi possível alterar a senha. Tente novamente.')
      setLoading(false)
      return
    }
    const res = await clearMustChangePassword()
    setLoading(false)
    if (res.error) {
      setError(res.error)
      return
    }
    router.replace('/home')
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-2">Defina sua senha</h2>
      <p className="text-sm text-slate-400 mb-6">
        Você entrou com uma senha temporária. Escolha uma senha nova para continuar.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Nova senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Input label="Confirmar nova senha" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">
          Salvar e continuar
        </Button>
      </form>
    </Card>
  )
}
