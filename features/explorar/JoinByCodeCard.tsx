'use client'
// features/explorar/JoinByCodeCard.tsx
// Entrar numa academia com o código do professor.
//
// Fecha o caminho de volta: quem criou a conta livre para jogar um torneio e
// depois começou a treinar precisa virar ALUNO daquela academia. O link de
// convite já fazia isso; aqui o código pode ser digitado direto, que é como ele
// costuma chegar (foto do cartaz, mensagem no grupo).
//
// A action `joinAcademy` é a mesma do link — inclusive a promoção de atleta
// para aluno mora nela, num lugar só.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { joinAcademy } from '@/features/organizations/actions'
import { setActiveOrg } from '@/features/organizations/setActiveOrg'

export function JoinByCodeCard() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await joinAcademy(code.trim())
      if (res.error) {
        setError(res.error)
        return
      }
      // Entrar numa academia é justamente escolhê-la: deixar o cookie apontando
      // para outra faria a Home abrir na academia errada logo depois.
      if (res.orgId) await setActiveOrg(res.orgId)
      router.push('/home')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.02] px-4 py-3 text-left transition-colors hover:border-brand-600/50"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400">
          <KeyRound className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white">Tenho um código da academia</span>
          <span className="block text-xs text-slate-400">Entre como aluno e libere aulas e ranking</span>
        </span>
      </button>
    )
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="codigo-academia" className="text-sm font-semibold text-white">
            Código da academia
          </label>
          <input
            id="codigo-academia"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Ex: ARENA123"
            autoCapitalize="characters"
            autoComplete="off"
            className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm uppercase tracking-wider text-white placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-500 focus:border-brand-600/60 focus:outline-none focus:ring-1 focus:ring-brand-600/40"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" loading={isPending} size="sm" className="flex-1">
            Entrar na academia
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  )
}
