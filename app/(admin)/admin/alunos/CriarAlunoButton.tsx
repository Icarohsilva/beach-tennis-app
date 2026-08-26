'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { createStudent } from '@/features/organizations/actions'
import { sendPasswordResetLink } from '@/features/aulas/studentIdentityActions'
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
  // password null = criado sem e-mail (cadastro gerenciado, sem login).
  const [criado, setCriado] = useState<{ password: string | null; studentId: string | null } | null>(null)
  const [linkResult, setLinkResult] = useState<{ whatsappUrl?: string; emailSent?: boolean } | null>(null)
  const [linkError, setLinkError] = useState('')
  const [sendingLink, setSendingLink] = useState<'whatsapp' | 'email' | null>(null)

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
    setCriado({ password: res.password ?? null, studentId: res.studentId ?? null })
    router.refresh()
  }

  async function handleSendLink(channel: 'whatsapp' | 'email') {
    if (!criado?.studentId) return
    setLinkError('')
    setSendingLink(channel)
    const res = await sendPasswordResetLink(criado.studentId, channel)
    setSendingLink(null)
    if (res.error) {
      setLinkError(res.error)
      return
    }
    if (channel === 'whatsapp' && res.whatsappUrl) {
      window.open(res.whatsappUrl, '_blank', 'noopener,noreferrer')
      setLinkResult({ whatsappUrl: res.whatsappUrl })
    } else {
      setLinkResult({ emailSent: true })
    }
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
    setLinkResult(null)
    setLinkError('')
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

                {/* Alternativa a repassar a senha temporária: manda um link para o
                    próprio aluno definir a senha dele. */}
                {criado.studentId && !linkResult && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">Ou mande um link para ele definir a senha:</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        loading={sendingLink === 'whatsapp'}
                        disabled={sendingLink !== null}
                        onClick={() => handleSendLink('whatsapp')}
                      >
                        📱 WhatsApp
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        loading={sendingLink === 'email'}
                        disabled={sendingLink !== null}
                        onClick={() => handleSendLink('email')}
                      >
                        ✉️ E-mail
                      </Button>
                    </div>
                    {linkError && <p className="text-xs text-red-400">{linkError}</p>}
                  </div>
                )}
                {linkResult?.whatsappUrl && (
                  <p className="text-xs text-green-400">
                    Link aberto no WhatsApp.{' '}
                    <a href={linkResult.whatsappUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      Abrir de novo
                    </a>
                  </p>
                )}
                {linkResult?.emailSent && (
                  <p className="text-xs text-green-400">E-mail enviado.</p>
                )}
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
