'use client'
// app/(admin)/admin/torneios/[id]/ShirtsCard.tsx
// A encomenda de camisas deste torneio: quanto de cada tamanho e a planilha.
//
// O resumo na tela e o CSV saem da MESMA lista (`summarizeShirtSizes` e
// `shirtRowsToCsv` sobre `rows`) — o admin decide encomendar olhando o resumo e
// confere na planilha, e duas somas por caminhos diferentes é como elas
// divergem no dia de fechar com a confecção.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { ShirtFields } from '@/features/torneios/ShirtFields'
import { setEntryShirt } from '@/features/torneios/configActions'
import {
  shirtRowsToCsv,
  summarizeShirtSizes,
  type ShirtRow,
} from '@/lib/torneios/shirt'

export function ShirtsCard({
  rows,
  tournamentName,
  withNames = false,
}: {
  rows: ShirtRow[]
  tournamentName: string
  /** A camisa é estampada: o card também cobra os nomes que faltam. */
  withNames?: boolean
}) {
  // A encomenda é de quem VAI jogar. Fila de espera não entra na conta — a
  // arena não manda fazer camisa para quem talvez não jogue —, mas continua na
  // planilha, com a situação na coluna, para o caso de alguém subir.
  const confirmed = rows.filter((r) => r.entryStatus === 'confirmed')
  const summary = summarizeShirtSizes(confirmed.map((r) => r.size))
  // Nome faltando é pendência SEPARADA do tamanho: dá para ter a grade fechada
  // e ainda não poder mandar estampar. Somar os dois numa contagem só faria o
  // admin achar que falta tamanho quando o que falta é nome.
  const missingNames = withNames
    ? confirmed.filter((r) => !r.shirtName).length
    : 0
  // Falta tamanho, ou falta a estampa num torneio que estampa. Os dois casos
  // se resolvem no mesmo lugar, com o mesmo campo.
  const pendentes = confirmed.filter((r) => !r.size || (withNames && !r.shirtName))

  function download() {
    const csv = shirtRowsToCsv(rows)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `camisas-${slug(tournamentName)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white">Camisas</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {summary.total === 0
              ? 'Ninguém informou tamanho ainda.'
              : `${summary.total} camisa(s) para ${confirmed.length} inscrito(s) confirmado(s).`}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={download} disabled={rows.length === 0}>
          Baixar planilha
        </Button>
      </div>

      {summary.tally.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.tally.map((t) => (
            <span
              key={t.size}
              className="rounded-lg border border-surface-border bg-surface px-2.5 py-1 text-xs text-slate-300"
            >
              {t.label} <span className="font-bold text-white">{t.count}</span>
            </span>
          ))}
        </div>
      )}

      {/* A pergunta operacional é "já dá para encomendar?", e ela só se responde
          sabendo quem falta. Sem esta linha o admin fecha o pedido a menos. */}
      {summary.missing > 0 && (
        <p className="text-xs text-yellow-300">
          {summary.missing} inscrito(s) confirmado(s) ainda sem tamanho — provavelmente entraram
          antes de o torneio passar a dar camisa. Eles aparecem como &quot;NAO INFORMADO&quot; na planilha.
        </p>
      )}

      {missingNames > 0 && (
        <p className="text-xs text-yellow-300">
          {missingNames} inscrito(s) confirmado(s) sem o nome da estampa. A coluna
          &quot;Nome na camisa&quot; vai vazia para eles.
        </p>
      )}

      {/* Quem falta, com o campo ao lado. É o caminho de quem já estava inscrito
          quando a arena ligou a camisa: o aluno também resolve sozinho pelo app,
          mas o admin não pode ficar refém disso para fechar a encomenda. */}
      {pendentes.length > 0 && (
        <div className="space-y-2 border-t border-surface-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Preencher por quem falta
          </p>
          {pendentes.map((r) => (
            <MissingRow
              key={`${r.entryId}-${r.side}`}
              row={r}
              askName={withNames}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'torneio'
}

/** Uma pessoa sem camisa informada, com o campo para o admin preencher. */
function MissingRow({ row, askName }: { row: ShirtRow; askName: boolean }) {
  const router = useRouter()
  const [size, setSize] = useState(row.size ?? '')
  const [name, setName] = useState(row.shirtName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()

  function save() {
    setError(null)
    startTransition(async () => {
      const r = await setEntryShirt(row.entryId, {
        size,
        name: askName ? name : undefined,
        side: row.side,
      })
      if (r.error) { setError(r.error); return }
      setDone(true)
      router.refresh()
    })
  }

  if (done) {
    return (
      <p className="text-xs text-green-400">✓ {row.name} — registrado.</p>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-surface-border bg-surface p-2.5">
      <p className="truncate text-sm font-medium text-white">{row.name}</p>
      <ShirtFields
        size={size}
        onSize={setSize}
        name={name}
        onName={setName}
        askName={askName}
        label="Tamanho"
        nameLabel="Nome na camisa"
      />
      <Button
        size="sm"
        variant="secondary"
        loading={isPending}
        disabled={!size || (askName && !name.trim())}
        onClick={save}
      >
        Salvar
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
