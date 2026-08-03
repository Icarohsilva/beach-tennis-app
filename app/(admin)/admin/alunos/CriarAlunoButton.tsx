'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { createStudent } from '@/features/organizations/actions'
import { SportsPicker } from '@/components/ui/SportsPicker'

export function CriarAlunoButton({ orgSports }: { orgSports: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [sports, setSports] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [password, setPassword] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await createStudent({ fullName, email, phone, sports })
    setLoading(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setPassword(res.password ?? '')
    router.refresh()
  }

  function reset() {
    setOpen(false)
    setFullName('')
    setEmail('')
    setPhone('')
    setSports([])
    setError('')
    setPassword(null)
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm">
        Criar aluno
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-md">
        {password !== null ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Aluno criado!</h2>
            <p className="text-sm text-slate-400">
              Copie e repasse ao aluno. No 1º login, o sistema pedirá para trocar a senha.
            </p>
            <div className="bg-surface border border-surface-border rounded-lg px-3 py-2">
              <p className="text-xs text-slate-500">Senha temporária</p>
              <p className="text-lg font-mono text-brand-400 break-all">{password}</p>
            </div>
            <Button onClick={reset} className="w-full">
              Fechar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Criar aluno</h2>
            <Input
              label="Nome completo"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
            <Input
              label="E-mail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {/* Opcional, mas é o que habilita cobrar por WhatsApp em Controle
                Wellhub. Mesma convenção do perfil do aluno. */}
            <Input
              label="WhatsApp"
              type="tel"
              placeholder="(11) 99999-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {/* Esportes que o aluno pratica nesta academia — base dos rankings da
                Liga. Não restringe em nada quais turmas ele pode frequentar. */}
            <SportsPicker
              value={sports}
              onChange={setSports}
              options={orgSports}
              allowCustom={false}
              label="Esportes (opcional)"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" loading={loading} className="flex-1">
                Criar
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}
