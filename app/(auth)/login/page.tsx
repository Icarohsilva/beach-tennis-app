// app/(auth)/login/page.tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.toLowerCase().includes('email not confirmed')) {
        setError('Confirme seu email antes de entrar. Verifique sua caixa de entrada.')
      } else if (error.message.toLowerCase().includes('invalid login credentials') || error.message.toLowerCase().includes('invalid credentials')) {
        setError('Email ou senha incorretos.')
      } else {
        setError(error.message)
      }
      setLoading(false)
      return
    }
    router.push('/home')
    router.refresh()
  }

  return (
    <Card>
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
        <Link href="/cadastro" className="hover:text-brand-400">Criar conta</Link>
        <Link href="/recuperar-senha" className="hover:text-brand-400">Esqueci minha senha</Link>
      </div>
    </Card>
  )
}
