'use client'
// app/(public)/d/[id]/cadastrar/DayUseSignupForm.tsx
// Conta do APLICATIVO, não vínculo com a arena: nenhum `org_invite_code` vai no
// metadata (ver o comentário da page). Também não pede modalidade nem gênero —
// nada disso é usado para reservar day use, e cada campo a mais é gente
// desistindo antes de chegar na quadra.
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { formatWhatsApp, parseWhatsApp } from '@/lib/utils/phone'

export function DayUseSignupForm({ slotId, subtitle }: { slotId: string; subtitle: string }) {
  const router = useRouter()
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState(false)

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.full_name.trim()) { setError('Informe seu nome completo.'); return }
    // Obrigatório: é por ele que a arena cobra quem paga na porta e avisa
    // mudança de horário de quem não é aluno e não abre o app todo dia.
    const phone = parseWhatsApp(form.phone)
    if (!phone.ok) { setError(phone.error); return }
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          full_name: form.full_name.trim(),
          phone: phone.formatted,
        },
      },
    })
    if (signUpErr) {
      const msg = signUpErr.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
        setError('Esse email já tem uma conta. Faça login para reservar.')
      } else if (msg.includes('password')) {
        setError('A senha precisa ter pelo menos 6 caracteres.')
      } else {
        setError('Não foi possível criar a conta. Tente novamente.')
      }
      setLoading(false)
      return
    }
    if (data.session) {
      setLoading(false)
      router.push(`/d/${slotId}`)
      router.refresh()
      return
    }
    // Academia com confirmação de e-mail ligada: sem sessão, não há como
    // reservar agora. Dizer isso é melhor que voltar para a página e o botão
    // continuar pedindo conta.
    setConfirmEmail(true)
    setLoading(false)
  }

  if (confirmEmail) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <Card>
          <div className="-mx-4 -mt-4 mb-6 h-1.5 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
          <div className="py-4 text-center">
            <div className="mb-4 text-4xl">📧</div>
            <h2 className="mb-2 text-lg font-semibold text-white">Confirme seu email</h2>
            <p className="mb-4 text-sm text-slate-400">
              Enviamos um link para <span className="text-brand-400">{form.email}</span>.
              Ative a conta e volte para garantir sua vaga.
            </p>
            <Link href={`/d/${slotId}`} className="text-sm text-brand-400 hover:text-brand-300">
              ← Voltar ao day use
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Card>
        <div className="-mx-4 -mt-4 mb-6 h-1.5 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <h2 className="mb-1 text-lg font-semibold text-white">Criar conta para reservar</h2>
        <p className="mb-6 text-sm text-slate-400">{subtitle}</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input label="Nome completo" value={form.full_name} onChange={set('full_name')} required />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
          <Input
            label="WhatsApp"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: formatWhatsApp(e.target.value) }))}
            placeholder="(31) 99999-9999"
            hint="Com DDD. É por ele que a arena confirma sua reserva e o pagamento."
            required
          />
          <Input
            label="Senha"
            type="password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={6}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" loading={loading} size="lg" className="w-full">
            Criar conta
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">
          A conta é do aplicativo. Você não passa a ser aluno da academia por reservar um day use.
        </p>
        <div className="mt-4 text-center text-sm text-slate-400">
          Já tem conta?{' '}
          <Link href={`/login?next=/d/${slotId}`} className="text-brand-400 hover:text-brand-300">
            Entrar
          </Link>
        </div>
      </Card>
    </div>
  )
}
