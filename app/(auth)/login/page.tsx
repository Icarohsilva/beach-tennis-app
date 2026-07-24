// app/(auth)/login/page.tsx
'use client'
import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

function LoginInner() {
  const searchParams = useSearchParams()
  // Convite na URL: depois do login, volta pro fluxo de entrar na academia.
  const inviteCode = (searchParams.get('convite') ?? '').trim()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.toLowerCase().includes('email not confirmed')) {
        setError('Confirme seu email antes de entrar. Verifique sua caixa de entrada.')
      } else if (error.message.toLowerCase().includes('invalid login credentials') || error.message.toLowerCase().includes('invalid credentials')) {
        setError('Email ou senha incorretos.')
      } else {
        setError('Não foi possível entrar. Tente novamente.')
      }
      setLoading(false)
      return
    }
    // Veio de um convite: manda pro fluxo de entrar na academia (já logado).
    if (inviteCode) {
      window.location.href = `/cadastro?convite=${encodeURIComponent(inviteCode)}`
      return
    }
    // Papel vem de memberships (profiles.role foi dropada no cutover de identidade).
    // Admin em qualquer academia → painel; senão → home do aluno.
    const { data: memberships } = await supabase
      .from('memberships')
      .select('role')
      .eq('user_id', authData.user.id)
    const isAdmin = (memberships ?? []).some((m) => m.role === 'admin')
    // Navegação FORÇADA (hard nav), não router.push(): o painel admin tem um
    // redirect() dentro de app/(admin)/layout.tsx (gate de assinatura) que é
    // conhecidamente não-confiável do Next.js quando disparado por navegação
    // client-side — produz tela em branco (RSC stream incompleto) até um reload
    // manual. Um hard nav sempre completa a cadeia de redirect corretamente,
    // igual a um F5. Ver github.com/vercel/next.js/issues/43464 e /issues/67427.
    window.location.href = isAdmin ? '/admin/dashboard' : '/home'
  }

  const cadastroHref = inviteCode ? `/cadastro?convite=${encodeURIComponent(inviteCode)}` : '/cadastro'

  return (
    <Card>
      <div className="h-1.5 -mx-4 -mt-4 mb-6 rounded-t-xl bg-gradient-to-r from-brand-500 to-brand-700" />
      <h2 className="text-lg font-semibold text-white mb-6">Entrar</h2>
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={loading} size="lg" className="w-full">
          Entrar
        </Button>
      </form>
      <div className="mt-4 flex flex-col gap-2 text-center text-sm text-slate-400">
        <Link href={cadastroHref} className="hover:text-brand-400">Criar conta</Link>
        <Link href="/recuperar-senha" className="hover:text-brand-400">Esqueci minha senha</Link>
      </div>
      <div className="mt-2 text-center">
        <Link href="/criar-academia" className="text-sm text-brand-400 hover:text-brand-300">
          É professor? Crie sua academia
        </Link>
      </div>
    </Card>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
