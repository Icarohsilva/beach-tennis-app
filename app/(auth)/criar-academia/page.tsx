// app/(auth)/criar-academia/page.tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createAcademy } from '@/features/organizations/actions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

export default function CriarAcademiaPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    academyName: '', fullName: '', email: '', password: '', phone: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await createAcademy(form)
    if (res.error) {
      setError(res.error)
      setLoading(false)
      return
    }

    // Auto-login com as credenciais recém-criadas → vai pro painel admin.
    const supabase = createClient()
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: form.email.trim(),
      password: form.password,
    })
    if (signErr) {
      // Conta criada, mas auto-login falhou: manda pro login.
      router.push('/login')
      return
    }
    router.push('/onboarding')
    router.refresh()
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-1">Crie sua academia</h2>
      <p className="text-slate-400 text-sm mb-6">Comece a gerenciar suas aulas em minutos.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Nome da academia" value={form.academyName} onChange={set('academyName')} required />
        <Input label="Seu nome" value={form.fullName} onChange={set('fullName')} required />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
        <Input label="Telefone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(11) 99999-9999" />
        <Input label="Senha" type="password" value={form.password} onChange={set('password')} required minLength={6} />

        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">
          Criar academia
        </Button>
      </form>
      <div className="mt-4 text-center text-sm text-slate-400">
        <Link href="/login" className="hover:text-brand-400">Já tem conta? Entrar</Link>
      </div>
    </Card>
  )
}
