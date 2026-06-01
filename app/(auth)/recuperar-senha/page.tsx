// app/(auth)/recuperar-senha/page.tsx
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/nova-senha`,
    })
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <Card>
        <p className="text-green-400 text-sm text-center">
          Email enviado! Verifique sua caixa de entrada.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-white mb-6">Recuperar senha</h2>
      <form onSubmit={handleReset} className="flex flex-col gap-4">
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Button type="submit" loading={loading} size="lg" className="w-full">
          Enviar link de recuperação
        </Button>
      </form>
    </Card>
  )
}
