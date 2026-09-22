'use client'
// app/(admin)/admin/torneios/[id]/ShirtsCard.tsx
// A encomenda de camisas deste torneio: quanto de cada tamanho e a planilha.
//
// O resumo na tela e o CSV saem da MESMA lista (`summarizeShirtSizes` e
// `shirtRowsToCsv` sobre `rows`) — o admin decide encomendar olhando o resumo e
// confere na planilha, e duas somas por caminhos diferentes é como elas
// divergem no dia de fechar com a confecção.
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
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
