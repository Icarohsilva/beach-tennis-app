// app/(auth)/definir-senha/page.tsx
// Troca FORÇADA de senha no 1º login (aluno criado pelo admin com senha temporária).
// Distinta da /nova-senha (fluxo de link de recuperação PKCE). Aqui o usuário JÁ está
// logado: define a nova senha via updateUser e limpa must_change_password.
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { clearMustChangePassword } from '@/features/auth/actions'
import { acceptLegalDocuments } from '@/features/legal/actions'
import { STUDENT_REQUIRED_SLUGS } from '@/lib/legal/documents'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'

export default function DefinirSenhaPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)

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
    if (!acceptedTerms) {
      setError('Você precisa aceitar os Termos de Uso e a Política de Privacidade.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { data: userData, error: updErr } = await supabase.auth.updateUser({ password })
    if (updErr) {
      setError('Não foi possível alterar a senha. Tente novamente.')
      setLoading(false)
      return
    }
    // Usuário já autenticado neste ponto — sessão real, sem risco de IDOR.
    if (userData.user) {
      await acceptLegalDocuments(userData.user.id, STUDENT_REQUIRED_SLUGS)
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
        <Button type="submit" loading={loading} size="lg" className="w-full">
          Salvar e continuar
        </Button>
      </form>
    </Card>
  )
}
