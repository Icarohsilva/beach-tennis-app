// app/(admin)/admin/liga/OverviewCards.tsx
import { Users, CalendarCheck, Heart, Medal, PhoneCall } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import { DIVISION_LABEL } from '@/lib/liga/labels'
import type { OrgLigaOverview } from '@/features/liga/orgOverview'
import type { LigaDivision } from '@/types'

interface Props {
  overview: OrgLigaOverview
  orgName: string
}

const DIVISOES: LigaDivision[] = ['bronze', 'prata', 'ouro', 'diamante']

/**
 * O retrato da Liga para a academia.
 *
 * A lista de quem sumiu vem com botão de WhatsApp porque o número sozinho não faz
 * nada: o valor está em o professor mandar mensagem antes de o aluno cancelar o plano.
 */
export function OverviewCards({ overview, orgName }: Props) {
  const alcance =
    overview.totalStudents > 0
      ? Math.round((overview.scoring / overview.totalStudents) * 100)
      : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Alunos pontuando"
          value={overview.scoring}
          hint={`${alcance}% dos ${overview.totalStudents} da academia`}
          icon={Users}
        />
        <StatCard
          label="Presenças na temporada"
          value={overview.attendancePoints}
          icon={CalendarCheck}
        />
        <StatCard label="Elogios trocados" value={overview.kudos} icon={Heart} />
        <StatCard
          label="Medalhas em 30 dias"
          value={overview.recentMedals}
          icon={Medal}
        />
      </div>

      <Card>
        <p className="mb-3 text-xs tracking-wide text-slate-400">ALUNOS POR DIVISÃO</p>
        <ul className="space-y-2">
          {DIVISOES.map((division) => {
            const total = overview.byDivision[division] ?? 0
            const maior = Math.max(1, ...DIVISOES.map((d) => overview.byDivision[d] ?? 0))
            return (
              <li key={division} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-xs text-slate-400">
                  {DIVISION_LABEL[division]}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                  <span
                    className="block h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.round((total / maior) * 100)}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-300">
                  {total}
                </span>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card>
        <p className="mb-1 text-xs tracking-wide text-slate-400">TREINAVAM E SUMIRAM</p>
        <p className="mb-3 text-xs text-slate-500">
          Alunos com presença nos últimos 3 meses, mas nada nas últimas 2 semanas. É a lista
          para puxar conversa antes de virar cancelamento.
        </p>

        {overview.missing.length === 0 ? (
          <p className="text-sm text-slate-300">Ninguém sumiu. Aproveite.</p>
        ) : (
          <ul className="space-y-1.5">
            {overview.missing.map((student) => (
              <li key={student.studentId} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-200">{student.name}</span>
                <span className="shrink-0 text-xs text-amber-300">
                  {student.daysAway} dias
                </span>
                {student.phone && (
                  <a
                    href={buildWhatsAppUrl(
                      student.phone,
                      `Oi, ${student.name.split(' ')[0]}! Sentimos sua falta na ${orgName}. Bora marcar uma aula essa semana?`,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-surface-border hover:text-emerald-400"
                    title="Chamar no WhatsApp"
                  >
                    <PhoneCall className="h-3.5 w-3.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
