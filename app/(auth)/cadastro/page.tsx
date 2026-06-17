// app/(auth)/cadastro/page.tsx
'use client'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveInviteCode } from '@/features/organizations/actions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

function CadastroInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteCode = (searchParams.get('convite') ?? '').trim()

  const [resolving, setResolving] = useState(true)
  const [orgName, setOrgName] = useState<string | null>(null)

  const [form, setForm] = useState({ full_name: '', email: '', password: '', phone: '' })
  const [partner, setPartner] = useState<'none' | 'wellhub' | 'totalpass'>('none')
  const [partnerId, setPartnerId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState(false)

  // Resolve o código de convite → nome da academia. Sem código válido = bloqueia.
  useEffect(() => {
    let active = true
    if (!inviteCode) { setResolving(false); return }
    resolveInviteCode(inviteCode).then((res) => {
      if (!active) return
      setOrgName(res?.orgName ?? null)
      setResolving(false)
    })
    return () => { active = false }
  }, [inviteCode])

  async function handleCadastro(e: React.FormEvent) {
    e.preventDefault()
    if (partner !== 'none' && !partnerId.trim()) {
      setError('Informe o ID do seu Gympass/TotalPass.')
      return
    }
    setLoading(true)
    setError('')
    const supabase = createClient()
    const meta: Record<string, string> = { full_name: form.full_name, org_invite_code: inviteCode }
    if (form.phone.trim()) meta.phone = form.phone.trim()
    if (partner !== 'none') {
      meta.pending_partner = partner
      meta.partner_id = partnerId.trim()
    }
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: meta },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    if (data.session) {
      router.push('/home')
      router.refresh()
      return
    }
    setConfirmEmail(true)
    setLoading(false)
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  if (resolving) {
    return (
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <p className="text-slate-400 text-sm text-center py-6">Carregando...</p>
      </Card>
    )
  }

  // BLOQUEIO: sem código de convite válido não é possível cadastrar aluno.
  if (!orgName) {
    return (
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <div className="text-center py-4">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-lg font-semibold text-white mb-2">Convite necessário</h2>
          <p className="text-slate-400 text-sm mb-6">
            Para se cadastrar como aluno, use o <span className="text-brand-400">link de convite</span> da sua academia.
            Peça o link ao seu professor.
          </p>
          <Link href="/criar-academia" className="text-brand-400 text-sm hover:text-brand-300">
            É professor? Crie sua academia →
          </Link>
          <div className="mt-3">
            <Link href="/login" className="text-slate-500 text-sm hover:text-slate-300">Já tem conta? Entrar</Link>
          </div>
        </div>
      </Card>
    )
  }

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
          <p className="text-slate-500 text-xs mb-6">Não recebeu? Verifique sua pasta de spam.</p>
          <Link href="/login" className="text-brand-400 text-sm hover:text-brand-300">Ir para o login →</Link>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-1">Criar conta</h2>
      <p className="text-slate-400 text-sm mb-6">
        Você está se cadastrando na <span className="text-brand-400">{orgName}</span>.
      </p>
      <form onSubmit={handleCadastro} className="flex flex-col gap-4">
        <Input label="Nome completo" value={form.full_name} onChange={set('full_name')} required />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} required />
        <Input label="Telefone" type="tel" value={form.phone} onChange={set('phone')} placeholder="(11) 99999-9999" />
        <label className="text-sm text-slate-300">
          Você usa Gympass ou TotalPass?
          <select
            value={partner}
            onChange={(e) => setPartner(e.target.value as 'none' | 'wellhub' | 'totalpass')}
            className="mt-1 block w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="none">Não uso</option>
            <option value="wellhub">Gympass (Wellhub)</option>
            <option value="totalpass">TotalPass</option>
          </select>
        </label>
        {partner !== 'none' && (
          <Input label="ID do Gympass/TotalPass" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required />
        )}
        <Input label="Senha" type="password" value={form.password} onChange={set('password')} required minLength={6} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">Criar conta</Button>
      </form>
      <div className="mt-4 text-center text-sm text-slate-400">
        <Link href="/login" className="hover:text-brand-400">Já tem conta? Entrar</Link>
      </div>
    </Card>
  )
}

export default function CadastroPage() {
  return (
    <Suspense fallback={null}>
      <CadastroInner />
    </Suspense>
  )
}
