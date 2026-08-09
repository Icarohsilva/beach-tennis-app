// features/torneios/BracketView.tsx
// A chave desenhada: uma coluna por fase, da primeira rodada até a final.
//
// As colunas usam `justify-around` com altura igual, que é o truque que faz a
// semifinal aparecer centralizada entre as duas quartas que a alimentam — o
// mesmo desenho que se faz no papel, sem precisar calcular posição.
//
// No celular a chave rola na horizontal, como nos apps de torneio. A alternativa
// (empilhar tudo) perderia justamente a leitura de caminho, que é o motivo de
// existir uma chave.
import { Trophy } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { BracketColumn, BracketNode, BracketSide } from '@/lib/torneios/bracketView'

interface BracketViewProps {
  columns: BracketColumn[]
}

export function BracketView({ columns }: BracketViewProps) {
  if (columns.length === 0) return null
  const lastRound = columns[columns.length - 1].round

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin]">
      <div className="flex min-w-max items-stretch gap-3">
        {columns.map((column) => (
          <div key={column.round} className="flex w-[190px] shrink-0 flex-col">
            <p
              className={cn(
                'mb-2 text-center text-[11px] font-bold uppercase tracking-wide',
                column.round === lastRound ? 'text-brand-400' : 'text-slate-500',
              )}
            >
              {column.label}
            </p>
            {/* justify-around distribui as partidas no mesmo espaço em todas as
                colunas — é o que alinha cada confronto com os dois que o geram. */}
            <div className="flex flex-1 flex-col justify-around gap-2">
              {column.nodes.map((node) => (
                <BracketCard key={node.id} node={node} isFinal={node.round === lastRound} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BracketCard({ node, isFinal }: { node: BracketNode; isFinal: boolean }) {
  if (node.kind === 'bye') {
    return (
      <div className="rounded-lg border border-dashed border-white/[0.12] bg-white/[0.02] px-2.5 py-2">
        <p className="truncate text-xs font-semibold text-slate-300">{node.byeLabel}</p>
        <p className="mt-0.5 text-[10px] font-medium text-slate-500">Passou direto</p>
      </div>
    )
  }

  const mine = node.side1.isMine || node.side2.isMine
  const decided = node.status === 'confirmed'

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-surface-card',
        mine
          ? 'border-brand-500/50 ring-1 ring-brand-500/20'
          : isFinal
            ? 'border-brand-600/30'
            : 'border-white/[0.08]',
      )}
    >
      {isFinal && (
        <p className="flex items-center gap-1 bg-brand-600/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-300">
          <Trophy className="h-3 w-3" aria-hidden />
          Decisão
        </p>
      )}
      <BracketRow side={node.side1} decided={decided} />
      <div className="h-px bg-white/[0.06]" />
      <BracketRow side={node.side2} decided={decided} />
      {node.status === 'pending' && (
        <p className="bg-yellow-500/10 px-2.5 py-1 text-[10px] font-semibold text-yellow-300">
          Aguardando confirmação
        </p>
      )}
    </div>
  )
}

function BracketRow({ side, decided }: { side: BracketSide; decided: boolean }) {
  // Perdedor confirmado apaga — é o que faz a chave ser lida de relance.
  const faded = decided && !side.isWinner
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
      <span
        className={cn(
          'truncate text-xs',
          faded ? 'font-medium text-slate-500' : 'font-semibold text-white',
          side.isMine && !faded && 'text-brand-300',
        )}
      >
        {side.label}
      </span>
      <span
        className={cn(
          'shrink-0 text-xs font-bold tabular-nums',
          side.games === null ? 'text-slate-600' : faded ? 'text-slate-500' : 'text-white',
        )}
      >
        {side.games ?? '–'}
      </span>
    </div>
  )
}
