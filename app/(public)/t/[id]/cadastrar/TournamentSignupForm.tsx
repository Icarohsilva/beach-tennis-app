'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

interface Props { tournamentId: string }

export function TournamentSignupForm({ tournamentId }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState(false)

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.full_name.trim()) { setError('Informe seu nome completo.'); return }
    setLoading(true)
    setError('')
    const supabase = createClient()
    // Sem org_invite_code nos metadados → handle_new_user cria profiles sem membership
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.full_name.trim() } },
    })
    if (signUpErr) {
      const msg = signUpErr.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
        setError('Esse email já tem uma conta. Faça login.')
      } else if (msg.includes('password')) {
        setError('A senha precisa ter pelo menos 6 caracteres.')
      } else {
        setError('Não foi possível criar a conta. Tente novamente.')
      }
      setLoading(false)
      return
    }
    if (data.session) {
      router.push(`/t/${tournamentId}`)
      router.refresh()
      return
    }
    setConfirmEmail(true)
    setLoading(false)
  }

  if (confirmEmail) {
    return (
      <div style={{ maxWidth: 420, margin: '40px auto', padding: '0 16px' }}>
        <Card>
          <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
          <div className="text-center py-4">
            <div className="text-4xl mb-4">📧</div>
            <h2 className="text-lg font-semibold text-white mb-2">Confirme seu email</h2>
            <p className="text-slate-400 text-sm mb-4">
              Enviamos um link para <span className="text-brand-400">{form.email}</span>.
              Clique no link para ativar sua conta e depois volte para se inscrever.
            </p>
            <Link href={`/t/${tournamentId}`} className="text-brand-400 text-sm hover:text-brand-300">
              ← Voltar ao torneio
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: '0 16px' }}>
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <h2 className="text-lg font-semibold text-white mb-1">Criar conta para jogar</h2>
        <p className="text-slate-400 text-sm mb-6">
          Sem convite necessário. Só para participar do torneio.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input label="Nome completo" value={form.full_name} onChange={set('full_name')} required />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
          <Input label="Senha" type="password" value={form.password} onChange={set('password')} required minLength={6} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" loading={loading} size="lg" className="w-full">Criar conta</Button>
        </form>
        <div className="mt-4 text-center text-sm text-slate-400">
          Já tem conta?{' '}
          <Link href={`/login?next=/t/${tournamentId}`} className="text-brand-400 hover:text-brand-300">
            Entrar
          </Link>
        </div>
      </Card>
    </div>
  )
}
