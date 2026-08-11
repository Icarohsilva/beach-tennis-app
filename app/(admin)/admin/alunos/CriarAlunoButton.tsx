'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { createStudent } from '@/features/organizations/actions'
import { SportsPicker } from '@/components/ui/SportsPicker'
import { cn } from '@/lib/utils/cn'
import type { AgeGroup } from '@/types'

export function CriarAlunoButton({ orgSports }: { orgSports: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [ageGroup, setAgeGroup] = useState<AgeGroup>('adult')
  const [sports, setSports] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // '' = criado sem e-mail (cadastro gerenciado, sem login); string = senha temporária.
  const [criado, setCriado] = useState<{ password: string | null } | null>(null)

  const semEmail = email.trim() === ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await createStudent({ fullName, email, phone, sports, ageGroup })
    setLoading(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setCriado({ password: res.password ?? null })
    router.refresh()
  }

  function reset() {
    setOpen(false)
    setFullName('')
    setEmail('')
    setPhone('')
    setAgeGroup('adult')
    setSports([])
    setError('')
    setCriado(null)
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
        {criado !== null ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Aluno criado!</h2>
            {criado.password ? (
              <>
                <p className="text-sm text-slate-400">
                  Copie e repasse ao aluno. No 1º login, o sistema pedirá para trocar a senha.
                </p>
                <div className="bg-surface border border-surface-border rounded-lg px-3 py-2">
                  <p className="text-xs text-slate-500">Senha temporária</p>
                  <p className="text-lg font-mono text-brand-400 break-all">{criado.password}</p>
                </div>
              </>
            ) : (
              // Sem e-mail não há senha para entregar: o cadastro existe para a
              // academia operar (chamada, grade, cobrança), não para o aluno entrar.
              <p className="text-sm text-slate-400">
                Cadastro sem e-mail: ele aparece na chamada, na grade e no financeiro, mas não
                entra no app — quem cuida de tudo por ele é a academia.
              </p>
            )}
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
            {/* Adulto ou kids nesta academia. Não bloqueia nada — serve para filtrar
                a lista e avisar quando a turma não bate com o aluno. */}
            <div>
              <label className="mb-1.5 block text-sm text-slate-300">Tipo de aluno</label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: 'adult' as const, label: 'Adulto' },
                    { value: 'kids' as const, label: 'Kids' },
                  ]
                ).map((op) => (
                  <button
                    key={op.value}
                    type="button"
                    onClick={() => setAgeGroup(op.value)}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                      ageGroup === op.value
                        ? 'border-brand-500 bg-brand-600/20 text-white'
                        : 'border-surface-border bg-surface text-slate-400 hover:text-white',
                    )}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Opcional desde que o Kids sem e-mail próprio precisou entrar: sem
                e-mail o aluno é criado como cadastro gerenciado pela academia, sem
                login. Com e-mail, o fluxo é o de sempre (senha temporária). */}
            <Input
              label="E-mail (opcional)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {semEmail && (
              <p className="-mt-2 text-xs text-slate-500">
                Sem e-mail, o aluno não entra no app: a academia agenda, marca presença e cobra
                por ele. Se ele tiver e-mail, preencha agora — é o que dá acesso a ele.
              </p>
            )}
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
