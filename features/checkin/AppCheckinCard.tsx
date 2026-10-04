'use client'
// features/checkin/AppCheckinCard.tsx
// "Check-in Wellhub de hoje" na home do aluno do plano Wellhub.
//
// Só aparece na arena que ligou o check-in pelo app e NÃO tem a integração do
// Wellhub conectada (lib/checkin/appCheckin.ts). O print é obrigatório: é a
// prova que a arena confere, já que aqui o Wellhub não avisa o sistema sozinho.
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ImagePlus, Smartphone } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button, buttonClasses } from '@/components/ui/Button'
import { compressImage } from '@/lib/utils/compressImage'
import { validateReceiptFile } from '@/lib/checkin/appCheckin'
import { submitAppCheckin } from './appCheckinActions'

interface Props {
  /** Check-in de hoje, se já existe (por qualquer caminho). */
  today: { at: string; viaApp: boolean; receiptStatus: 'validated' | 'review' | null } | null
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function AppCheckinCard({ today }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Libera a URL do preview ao trocar de arquivo ou sair da tela.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  if (today) {
    return (
      <Card className="flex items-start gap-3 border-emerald-500/30 bg-emerald-500/[0.06]">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Check-in de hoje registrado</p>
          <p className="text-xs text-slate-400">
            {!today.viaApp
              ? `Registrado pela arena às ${hora(today.at)}.`
              : today.receiptStatus === 'review'
                ? `Enviado às ${hora(today.at)}. A arena vai conferir o print.`
                : `Pelo app, às ${hora(today.at)}. Print validado.`}
          </p>
          {done && <p className="mt-1 text-xs text-emerald-300">{done}</p>}
        </div>
      </Card>
    )
  }

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    e.target.value = ''
    setError(null)
    if (!picked) return
    // Reduz antes de tudo: o print do celular passa do limite da server action.
    const small = await compressImage(picked)
    const err = validateReceiptFile(small)
    if (err) { setError(err); return }
    if (preview) URL.revokeObjectURL(preview)
    setFile(small)
    setPreview(URL.createObjectURL(small))
  }

  function handleSubmit() {
    if (!file) { setError('Anexe o print do check-in no app do Wellhub.'); return }
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.append('file', file)
      const r = await submitAppCheckin(fd)
      if (r.error) { setError(r.error); return }
      setDone(r.linkedSession ? 'Presença marcada na sua aula de agora.' : 'Check-in do dia contado.')
      // Print recusado nem chega aqui (volta como erro, com o motivo).
      router.refresh()
    })
  }

  return (
    <Card className="space-y-3 border-brand-600/30">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-brand-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Check-in Wellhub de hoje</p>
          <p className="text-xs text-slate-400">
            Fez o check-in no app do Wellhub? Registre aqui com o print da tela &quot;Check-in
            confirmado&quot;. O print precisa ser de hoje: a data e a hora são conferidas
            automaticamente.
          </p>
        </div>
      </div>

      {!open ? (
        <Button className="w-full" onClick={() => setOpen(true)}>
          Fazer check-in
        </Button>
      ) : (
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handlePick}
          />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Print do check-in"
              className="max-h-72 w-full rounded-lg bg-black/20 object-contain"
            />
          ) : (
            <p className="rounded-lg border border-dashed border-surface-border px-3 py-4 text-center text-xs text-slate-400">
              Tire um print da tela do Wellhub mostrando o check-in de hoje nesta arena.
            </p>
          )}
          <div className="flex flex-col gap-2 xs:flex-row">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={isPending}
              className={buttonClasses({ variant: 'secondary', size: 'md', className: 'flex-1' })}
            >
              <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden />
              {file ? 'Trocar print' : 'Anexar print'}
            </button>
            <Button className="flex-1" onClick={handleSubmit} loading={isPending} disabled={!file}>
              Enviar check-in
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </Card>
  )
}
