// app/(auth)/cadastro/page.tsx
'use client'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveInviteCode, joinAcademy } from '@/features/organizations/actions'
import { setActiveOrg } from '@/features/organizations/setActiveOrg'
import { acceptLegalDocuments } from '@/features/legal/actions'
import { STUDENT_REQUIRED_SLUGS } from '@/lib/legal/documents'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { SportsPicker } from '@/components/ui/SportsPicker'
import * as Sentry from '@sentry/nextjs'

function CadastroInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteCode = (searchParams.get('convite') ?? '').trim()

  const [resolving, setResolving] = useState(true)
  const [orgName, setOrgName] = useState<string | null>(null)
  // Modalidades da academia — domínio do seletor de esportes do aluno.
  const [orgSports, setOrgSports] = useState<string[]>([])
  const [sports, setSports] = useState<string[]>([])
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [joining, setJoining] = useState(false)
  // Visitante não logado escolhe entre Entrar (já tem conta) e Criar conta.
  const [showForm, setShowForm] = useState(false)

  const [form, setForm] = useState({ full_name: '', email: '', password: '', phone: '' })
  const [partner, setPartner] = useState<'none' | 'wellhub' | 'totalpass'>('none')
  const [partnerId, setPartnerId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)

  // Resolve o código de convite → nome da academia. Sem código válido = bloqueia.
  useEffect(() => {
    let active = true
    if (!inviteCode) { setResolving(false); return }
    resolveInviteCode(inviteCode).then((res) => {
      if (!active) return
      setOrgName(res?.orgName ?? null)
      setOrgSports(res?.sports ?? [])
      setResolving(false)
    })
    return () => { active = false }
  }, [inviteCode])

  // Detecta se já há sessão ativa: com login, o convite ENTRA na academia em vez
  // de criar conta (multi-vínculo).
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setLoggedIn(!!data.user))
  }, [])

  async function handleJoin() {
    setJoining(true)
    setError('')
    const res = await joinAcademy(inviteCode, sports)
    if (res.error || !res.orgId) {
      setError(res.error ?? 'Erro ao entrar na academia.')
      setJoining(false)
      return
    }
    await setActiveOrg(res.orgId)
    router.push('/home')
    router.refresh()
  }

  async function handleCadastro(e: React.FormEvent) {
    e.preventDefault()
    if (partner !== 'none' && !partnerId.trim()) {
      setError('Informe o ID do seu Gympass/TotalPass.')
      return
    }
    if (!acceptedTerms) {
      setError('Você precisa aceitar os Termos de Uso e a Política de Privacidade.')
      return
    }
    setLoading(true)
    setError('')
    const supabase = createClient()
    const meta: Record<string, string> = { full_name: form.full_name, org_invite_code: inviteCode }
    if (form.phone.trim()) meta.phone = form.phone.trim()
    // Os esportes vão pelo metadata porque handle_new_user() os grava na membership.
    // Uma server action pós-signUp não serviria: com confirmação de email ligada não
    // há sessão aqui, e mandar o user_id pelo cliente seria IDOR.
    if (sports.length > 0) meta.sports = sports.join(',')
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
      const msg = error.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
        setError('Esse email já tem uma conta. Faça login para entrar nesta academia.')
      } else if (msg.includes('password')) {
        setError('A senha precisa ter pelo menos 6 caracteres.')
      } else {
        setError('Não foi possível criar a conta. Tente novamente.')
      }
      setLoading(false)
      return
    }
    if (data.user) {
      // Best-effort: nunca bloqueia o cadastro se o registro do aceite falhar.
      acceptLegalDocuments(data.user.id, STUDENT_REQUIRED_SLUGS).catch((e) => {
        Sentry.captureException(e, { tags: { flow: 'cadastro_aluno_legal_acceptance' } })
      })
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

  if (resolving || loggedIn === null) {
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

  // Usuário JÁ logado abrindo um convite válido: entra na 2ª academia (multi-vínculo)
  // em vez de criar uma nova conta.
  if (orgName && loggedIn) {
    return (
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <h2 className="text-lg font-semibold text-white mb-1">Entrar em {orgName}</h2>
        <p className="text-slate-400 text-sm mb-6">
          Você já tem uma conta. Deseja entrar também na <span className="text-brand-400">{orgName}</span>?
        </p>
        <div className="mb-6">
          <SportsPicker
            value={sports}
            onChange={setSports}
            options={orgSports}
            allowCustom={false}
            label="Quais esportes você pratica aqui? (opcional)"
          />
        </div>
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <Button onClick={handleJoin} loading={joining} size="lg" className="w-full">
          Entrar nesta academia
        </Button>
      </Card>
    )
  }

  // Visitante NÃO logado com convite válido: pergunta se já tem conta na ArenaHub
  // antes de mostrar o formulário — evita que quem já tem conta tente recadastrar.
  if (orgName && !loggedIn && !showForm) {
    return (
      <Card>
        <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🎾</div>
          <h2 className="text-lg font-semibold text-white mb-1">Você foi convidado</h2>
          <p className="text-slate-400 text-sm">
            para entrar na <span className="text-brand-400">{orgName}</span>.
          </p>
        </div>
        <p className="text-sm text-slate-300 text-center mb-4">Você já tem conta na ArenaHub?</p>
        <div className="flex flex-col gap-3">
          <Link
            href={`/login?convite=${encodeURIComponent(inviteCode)}`}
            className="w-full inline-flex items-center justify-center rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-medium px-4 py-3 text-sm transition-colors"
          >
            Já tenho conta — Entrar
          </Link>
          <Button onClick={() => setShowForm(true)} variant="secondary" size="lg" className="w-full">
            É minha primeira vez — Criar conta
          </Button>
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
        <div>
          <SportsPicker
            value={sports}
            onChange={setSports}
            options={orgSports}
            allowCustom={false}
            label="Quais esportes você pratica aqui? (opcional)"
          />
          <p className="text-xs text-slate-500 mt-1">
            Define de quais rankings você participa. Você pode mudar depois no seu perfil.
          </p>
        </div>
        <Input label="Senha" type="password" value={form.password} onChange={set('password')} required minLength={6} />
        <Checkbox
          checked={acceptedTerms}
          onChange={(e) => setAcceptedTerms(e.target.checked)}
          required
          label={
            <>
              Li e aceito os{' '}
              <Link href="/legal/termos-de-uso" target="_blank" className="text-brand-400 hover:text-brand-300 underline">
                Termos de Uso
              </Link>{' '}
              e a{' '}
              <Link href="/legal/politica-privacidade" target="_blank" className="text-brand-400 hover:text-brand-300 underline">
                Política de Privacidade
              </Link>
            </>
          }
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">Criar conta</Button>
      </form>
      <div className="mt-4 text-center text-sm text-slate-400">
        <Link href={`/login?convite=${encodeURIComponent(inviteCode)}`} className="hover:text-brand-400">
          Já tem conta? Entrar
        </Link>
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
