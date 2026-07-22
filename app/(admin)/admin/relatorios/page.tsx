// app/(admin)/admin/relatorios/page.tsx
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { CalendarCheck, UserCheck, UserX, BellRing } from 'lucide-react'
import { getCurrentOrgId } from '@/lib/supabase/server'
import { getFrequencyReport } from '@/features/relatorios/query'
import { FrequencyTable } from '@/features/relatorios/FrequencyTable'
import { StatCard } from '@/components/ui/StatCard'
import { Reveal } from '@/components/ui/Reveal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { getWeekWindow, getMonthWindow, shiftWindow, type WindowKind } from '@/lib/utils/monthWindow'
import { formatDate } from '@/lib/utils/dateHelpers'

interface PageProps {
  searchParams: { periodo?: string; offset?: string }
}

export default async function RelatoriosPage({ searchParams }: PageProps) {
  const orgId = await getCurrentOrgId()
  const kind: WindowKind = searchParams.periodo === 'mes' ? 'month' : 'week'
  const offset = Number.parseInt(searchParams.offset ?? '0', 10) || 0

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const current = kind === 'week' ? getWeekWindow(now) : getMonthWindow(now)
  const window = offset === 0 ? current : shiftWindow(current, kind, offset)

  const report = await getFrequencyReport(orgId!, window, today)

  const label = kind === 'week'
    ? `${formatDate(window.from, "dd 'de' MMM")} – ${formatDate(window.to, "dd 'de' MMM")}`
    : formatDate(window.from, "MMMM 'de' yyyy")

  const linkFor = (nextKind: WindowKind, nextOffset: number) =>
    `/admin/relatorios?periodo=${nextKind === 'week' ? 'semana' : 'mes'}&offset=${nextOffset}`

  return (
    <div className="space-y-6">
      <Reveal step={0}>
        <div>
          <h1 className="text-2xl font-bold text-white">Relatório de frequência</h1>
          <p className="mt-1 text-sm text-slate-400">
            Quem está vindo às aulas. A presença é assumida para quem estava previsto — marque a
            falta na chamada para corrigir.
          </p>
        </div>
      </Reveal>

      {/* Período */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2">
          {(['week', 'month'] as WindowKind[]).map((k) => (
            <Link
              key={k}
              href={linkFor(k, 0)}
              className={
                'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ' +
                (kind === k
                  ? 'bg-brand-600 text-white'
                  : 'border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:text-white')
              }
            >
              {k === 'week' ? 'Semana' : 'Mês'}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={linkFor(kind, offset - 1)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300 hover:text-white"
          >
            ← anterior
          </Link>
          <span className="text-sm font-semibold capitalize text-white">{label}</span>
          {offset < 0 && (
            <Link
              href={linkFor(kind, offset + 1)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300 hover:text-white"
            >
              seguinte →
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Aulas no período" value={report.sessionsCount} icon={CalendarCheck} step={1} />
        <StatCard label="Presenças" value={report.totals.present} icon={UserCheck} step={2} />
        <StatCard label="Faltas" value={report.totals.absent} icon={UserX} step={3} />
        <StatCard label="Comparecimento" value={report.totals.rate} suffix="%" icon={BellRing} step={4} />
      </div>

      <Reveal step={5} as="section">
        <SectionHeader title="Por aluno" />
        <FrequencyTable rows={report.rows} />
      </Reveal>

      {report.unrecorded.length > 0 && (
        <Reveal step={6} as="section">
          <SectionHeader title="Aulas sem chamada" />
          <p className="mb-3 text-xs text-slate-400">
            Nestas aulas todo mundo entrou como presente. Se alguém faltou — ou a aula não
            aconteceu — ajuste na chamada.
          </p>
          <div className="space-y-2">
            {report.unrecorded.map((session) => (
              <Link key={session.id} href={`/admin/grade/${session.id}`} className="group block">
                <div className="glass flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] p-3.5 transition-all group-hover:-translate-y-0.5 group-hover:border-brand-600/40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{session.className}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {formatDate(session.date, "EEE, dd 'de' MMM")}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-brand-400">Fazer chamada →</span>
                </div>
              </Link>
            ))}
          </div>
        </Reveal>
      )}
    </div>
  )
}
