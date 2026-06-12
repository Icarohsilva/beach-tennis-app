// app/(auth)/cadastro/page.tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

export default function CadastroPage() {
  const router = useRouter()
  const [form, setForm] = useState({ full_name: '', email: '', password: '', phone: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState(false)

  async function handleCadastro(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.full_name } },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    // If session exists immediately → email confirmation disabled, go to home
    if (data.session) {
      router.push('/home')
      router.refresh()
      return
    }
    // Email confirmation required → show message
    setConfirmEmail(true)
    setLoading(false)
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  if (confirmEmail) {
    return (
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <div className="text-center py-4">
          <div className="text-4xl mb-4">📧</div>
          <h2 className="text-lg font-semibold text-white mb-2">Confirme seu email</h2>
          <p className="text-slate-400 text-sm mb-4">
            Enviamos um link de confirmação para <span className="text-brand-400">{form.email}</span>.
            Clique no link para ativar sua conta.
          </p>
          <p className="text-slate-500 text-xs mb-6">
            Não recebeu? Verifique sua pasta de spam.
          </p>
          <Link href="/login" className="text-brand-400 text-sm hover:text-brand-300">
            Ir para o login →
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-6">Criar conta</h2>
      <form onSubmit={handleCadastro} className="flex flex-col gap-4">
        <Input label="Nome completo" value={form.full_name} onChange={set('full_name')} required />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
        <Input label="Telefone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(11) 99999-9999" />
        <Input label="Senha" type="password" value={form.password} onChange={set('password')} required minLength={6} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">
          Criar conta
        </Button>
      </form>
      <div className="mt-4 text-center text-sm text-slate-400">
        <Link href="/login" className="hover:text-brand-400">Já tem conta? Entrar</Link>
      </div>
    </Card>
  )
}
