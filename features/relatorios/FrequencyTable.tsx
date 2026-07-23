// features/relatorios/FrequencyTable.tsx
'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils/cn'
import type { FrequencyRow } from './query'

type SortKey = 'rate' | 'present' | 'absent' | 'notified' | 'name'

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Aluno', numeric: false },
  { key: 'present', label: 'Presenças', numeric: true },
  { key: 'absent', label: 'Faltas', numeric: true },
  { key: 'notified', label: 'Avisou', numeric: true },
  { key: 'rate', label: 'Aproveit.', numeric: true },
]

export function FrequencyTable({ rows }: { rows: FrequencyRow[] }) {
  const [sort, setSort] = useState<SortKey>('rate')

  const sorted = [...rows].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'pt-BR')
    return b[sort] - a[sort] || a.name.localeCompare(b.name, 'pt-BR')
  })

  if (rows.length === 0) {
    return (
      <p className="glass rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-400">
        Nenhuma aula com aluno previsto neste período.
      </p>
    )
  }

  return (
    <div className="glass overflow-x-auto rounded-2xl border border-white/[0.07]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.07]">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn('px-3 py-2.5', col.numeric ? 'text-right' : 'text-left')}
              >
                <button
                  type="button"
                  onClick={() => setSort(col.key)}
                  className={cn(
                    'text-[10px] font-bold uppercase tracking-wider transition-colors',
                    sort === col.key ? 'text-brand-400' : 'text-slate-400 hover:text-white',
                  )}
                >
                  {col.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            // Falta sem aviso é o sinal que interessa: rótulo textual, não só cor.
            const alerta = row.absent > 0 && row.absent >= row.present
            return (
              <tr key={row.studentId} className="border-b border-white/[0.04] last:border-0">
                <td className="px-3 py-2.5">
                  <span className="font-medium text-white">{row.name}</span>
                  {alerta && (
                    <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      faltando muito
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-emerald-300">{row.present}</td>
                <td className="px-3 py-2.5 text-right text-slate-200">{row.absent}</td>
                <td className="px-3 py-2.5 text-right text-slate-400">{row.notified}</td>
                <td className="px-3 py-2.5 text-right font-bold text-white">{row.rate}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
