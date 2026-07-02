'use client'
// features/perfil/AccountSecurityForm.tsx
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface Props {
  currentEmail: string
}

export function AccountSecurityForm({ currentEmail }: Props) {
  const router = useRouter()
  const [email, setEmail] = useState(currentEmail)
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const emailChanged = email.trim() !== '' && email.trim() !== currentEmail
  const wantsPassword = password.length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)

    if (!emailChanged && !wantsPassword) {
      setError('Altere o email ou informe uma nova senha.')
      return
    }
    if (wantsPassword && password.length < 6) {
      setError('A nova senha precisa ter pelo menos 6 caracteres.')
      return
    }

    setPending(true)
    const supabase = createClient()
    const messages: string[] = []

    if (wantsPassword) {
      const { error: pwErr } = await supabase.auth.updateUser({ password })
      if (pwErr) {
        setError('Não foi possível alterar a senha. Tente sair e entrar novamente.')
        setPending(false)
        return
      }
      messages.push('Senha alterada.')
      setPassword('')
    }

    if (emailChanged) {
      const { error: emailErr } = await supabase.auth.updateUser({ email: email.trim() })
      if (emailErr) {
        const msg = emailErr.message.toLowerCase()
        setError(
          msg.includes('already') ? 'Esse email já está em uso.' : 'Não foi possível alterar o email.',
        )
        setPending(false)
        return
      }
      messages.push('Enviamos um link de confirmação para o novo email. O email só muda após a confirmação.')
    }

    setPending(false)
    setMessage(messages.join(' '))
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs text-slate-400 block mb-1">Email</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1">Nova senha</label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Deixe em branco para manter"
          minLength={6}
          autoComplete="new-password"
        />
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      {message && <p className="text-green-400 text-xs">{message}</p>}

      <Button type="submit" disabled={pending} size="sm">
        {pending ? 'Salvando...' : 'Atualizar conta'}
      </Button>
    </form>
  )
}
