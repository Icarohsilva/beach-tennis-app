// features/super-admin/BarSeries.tsx
import { AXIS_STROKE } from './chartPalette'

export interface BarPoint {
  label: string
  value: number
}

/**
 * Barra vertical de série ÚNICA — aquisição por mês, aulas por semana, etc.
 * Deliberadamente uma série só: duas medidas de escalas diferentes viram duas
 * pequenas-múltiplas, nunca dois eixos y no mesmo gráfico.
 *
 * Rótulos são seletivos (maior valor e último ponto); os demais aparecem no
 * hover via <title>, que também é lido por leitor de tela. Sem JS.
 */
export function BarSeries({
  points,
  color,
  height = 96,
  valueSuffix = '',
  emptyLabel = 'Sem dados no período.',
}: {
  points: BarPoint[]
  color: string
  height?: number
  valueSuffix?: string
  emptyLabel?: string
}) {
  if (points.length === 0) return <p className="text-xs text-slate-500">{emptyLabel}</p>

  const max = Math.max(...points.map((p) => p.value))
  if (max === 0) {
    return (
      <div className="space-y-2">
        <div
          className="w-full rounded"
          style={{ height, borderBottom: `1px solid ${AXIS_STROKE}` }}
        />
        <p className="text-xs text-slate-500">{emptyLabel}</p>
      </div>
    )
  }

  const lastIndex = points.length - 1
  const maxIndex = points.findIndex((p) => p.value === max)

  return (
    <div>
      <div
        className="flex items-end gap-[3px]"
        style={{ height, borderBottom: `1px solid ${AXIS_STROKE}` }}
      >
        {points.map((p, i) => {
          const pct = (p.value / max) * 100
          const labelled = i === maxIndex || i === lastIndex
          return (
            <div key={`${p.label}-${i}`} className="group relative flex flex-1 items-end justify-center">
              {labelled && p.value > 0 && (
                <span className="absolute -top-4 text-[10px] font-bold tabular-nums text-slate-300">
                  {p.value}
                  {valueSuffix}
                </span>
              )}
              <div
                title={`${p.label}: ${p.value}${valueSuffix}`}
                className="w-full rounded-t transition-opacity hover:opacity-80"
                style={{
                  // Piso de 2px para um valor 1 não sumir contra o eixo.
                  height: p.value === 0 ? 2 : `max(2px, ${pct}%)`,
                  backgroundColor: p.value === 0 ? AXIS_STROKE : color,
                }}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-1.5 flex gap-[3px]">
        {points.map((p, i) => (
          <span
            key={`${p.label}-lbl-${i}`}
            className="flex-1 truncate text-center text-[9px] text-slate-500"
          >
            {/* Em séries longas mostra 1 rótulo a cada 2 para não colidir. */}
            {points.length > 8 && i % 2 === 1 && i !== lastIndex ? '' : p.label}
          </span>
        ))}
      </div>
    </div>
  )
}
