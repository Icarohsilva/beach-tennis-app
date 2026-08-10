// app/(admin)/admin/wellhub/page.tsx
// Controle Wellhub: quem é aluno de parceiro, quanto já bipou no mês, quem está
// devendo check-in e como cobrar.
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId, getStaffContext } from '@/lib/supabase/server'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { Card } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { getWellhubOverview } from '@/features/checkin/missedCheckinQueries'
import { getPartnerCheckinRates } from '@/features/financeiro/partnerRevenueActions'
import { buildMissedCheckinMessage } from '@/lib/checkin/missedCheckins'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import { getMonthWindow, shiftWindow } from '@/lib/utils/monthWindow'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import { formatDate } from '@/lib/utils/dateHelpers'
import { HeartHandshake } from 'lucide-react'
import { WellhubSettingsCard } from './WellhubSettingsCard'
import { WellhubStudentRow } from './WellhubStudentRow'
import { ChargeAllButton } from './ChargeAllButton'
import type { CheckinPartner } from '@/types'

export const dynamic = 'force-dynamic'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * A lista mostra só quem precisa de ação — quem tem pendência em aberto. O
 * acompanhamento de check-ins do mês de TODO aluno de parceiro vive nos cards de
 * /admin/alunos, que é onde o professor olha no dia a dia. Aqui os números gerais
 * ficam nos KPIs do topo, e a lista é a fila de trabalho.
 */
type Filtro = 'com_pendencia' | 'bloqueados'

interface SearchParams {
  /** Offset de meses (0 = mês atual, -1 = mês passado). */
  mes?: string
  filtro?: string
  parceiro?: string
}

const FILTROS: { value: Filtro; label: string }[] = [
  { value: 'com_pendencia', label: 'Com pendência' },
  { value: 'bloqueados', label: 'Só bloqueados' },
]

export default async function WellhubPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const adminClient = createAdminClient()
  const orgId = (await getCurrentOrgId()) as string
  const staff = await getStaffContext()
  const isOwner = staff?.isOwner ?? false

  // Offset negativo só (não faz sentido olhar o futuro), limitado a 12 meses atrás.
  const rawMes = parseInt(searchParams.mes ?? '0', 10)
  const monthOffset = Number.isInteger(rawMes) ? Math.min(0, Math.max(-12, rawMes)) : 0
  const window = shiftWindow(getMonthWindow(new Date()), 'month', monthOffset)

  const filtro = (FILTROS.find((f) => f.value === searchParams.filtro)?.value ??
    'com_pendencia') as Filtro
  const parceiroFiltro =
    searchParams.parceiro === 'wellhub' || searchParams.parceiro === 'totalpass'
      ? (searchParams.parceiro as CheckinPartner)
      : null

  const overview = await getWellhubOverview(adminClient, orgId, window)

  // Rates só são lidas para o dono, porque só ele vê o card de configuração que as
  // exibe como referência (a action é owner-only).
  const rates = isOwner
    ? await getPartnerCheckinRates()
    : { wellhub: 0, totalpass: 0 }

  const { data: org } = await adminClient
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle()
  const orgName = (org as { name: string } | null)?.name ?? 'sua academia'
  const payUrl = `${getSiteUrl()}/financeiro`

  // Pendência em aberto é o piso da lista, não um filtro opcional: aluno em dia não
  // aparece aqui.
  const visible = overview.students.filter((s) => {
    if (s.summary.openCount === 0) return false
    if (parceiroFiltro && s.partner !== parceiroFiltro) return false
    if (filtro === 'bloqueados') return s.summary.blocked
    return true
  })

  const rows = visible.map((s) => ({
    studentId: s.studentId,
    fullName: s.fullName,
    partner: s.partner,
    openCount: s.summary.openCount,
    openAmount: s.summary.openAmount,
    blocked: s.summary.blocked,
    untilBlock: s.summary.untilBlock,
    pendencies: s.pendencies.map((p) => ({
      id: p.id,
      sessionDate: p.sessionDate,
      amount: p.amount,
      status: p.status,
      className: p.className,
    })),
    hasPhone: !!s.phone,
    // Mensagem montada no servidor com o MESMO builder do notifyUsers: o aluno lê
    // o mesmo texto venha pelo WhatsApp manual ou pela cobrança do app.
    whatsappUrl: s.phone
      ? buildWhatsAppUrl(
          s.phone,
          buildMissedCheckinMessage({
            studentName: s.fullName,
            orgName,
            dates: s.summary.dates,
            amount: s.summary.openAmount,
            blocked: s.summary.blocked,
            payUrl,
          }),
        )
      : null,
  }))

  const comPendencia = overview.students.filter((s) => s.summary.openCount > 0).length
  const monthLabel = formatDate(window.from, "MMMM 'de' yyyy")

  function monthHref(offset: number): string {
    const params = new URLSearchParams()
    if (offset !== 0) params.set('mes', String(offset))
    if (filtro !== 'com_pendencia') params.set('filtro', filtro)
    if (parceiroFiltro) params.set('parceiro', parceiroFiltro)
    const qs = params.toString()
    return qs ? `/admin/wellhub?${qs}` : '/admin/wellhub'
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Controle Wellhub</h1>
        <p className="text-slate-400 text-sm mt-1">
          Check-ins e pendências dos alunos de parceiro (Wellhub e TotalPass)
        </p>
      </div>

      {overview.students.length === 0 ? (
        <EmptyState
          icon={HeartHandshake}
          title="Nenhum aluno de parceiro ainda"
          description="Vincule um aluno ao Wellhub ou TotalPass na ficha dele para acompanhar os check-ins aqui."
          ctaHref="/admin/alunos"
          ctaLabel="Ver alunos"
        />
      ) : (
        <>
          {/* 1 coluna em celular: são os únicos StatCards com valor em moeda, e
              "R$ 12.345,67" não cabe em meia tela sem quebrar dentro do número. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {/* Leva para Alunos, onde cada card mostra o progresso do mês do aluno. */}
            <StatCard
              label="Alunos de parceiro"
              value={overview.totals.partnerStudents}
              hint={
                overview.totals.belowTarget > 0
                  ? `${overview.totals.belowTarget} abaixo da meta`
                  : 'todos na meta'
              }
              href="/admin/alunos"
              step={0}
            />
            <StatCard
              label="Check-ins no mês"
              value={overview.totals.checkinDays}
              hint="dias com check-in"
              step={1}
            />
            <StatCard
              label="Pendências abertas"
              value={overview.totals.openCount}
              hint={
                overview.totals.openAmount > 0
                  ? BRL.format(overview.totals.openAmount)
                  : 'sem valor configurado'
              }
              step={2}
            />
            <StatCard
              label="Deixou de receber"
              value={BRL.format(overview.totals.lostAmount)}
              hint="no mês, incluindo perdoadas"
              step={3}
            />
            <StatCard
              label="Bloqueados"
              value={overview.totals.blockedStudents}
              hint={
                overview.blockLimit > 0
                  ? `limite: ${overview.blockLimit} pendências`
                  : 'bloqueio desligado'
              }
              step={4}
            />
          </div>

          {overview.blockLimit === 0 && overview.totals.openCount > 0 && (
            <p className="text-xs text-brand-400">
              O bloqueio está desligado: as pendências são registradas e cobradas, mas
              ninguém deixa de agendar.
              {isOwner ? ' Ligue em "Regras de pendência", abaixo.' : ''}
            </p>
          )}

          {/* Filtros por GET, sem estado no cliente — padrão de /admin/alunos. */}
          <Card>
            <form method="GET" className="flex flex-wrap items-end gap-3">
              {monthOffset !== 0 && <input type="hidden" name="mes" value={monthOffset} />}
              <div className="space-y-1">
                <label className="block text-xs text-slate-400">Situação</label>
                <select
                  name="filtro"
                  defaultValue={filtro}
                  className="bg-surface border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
                >
                  {FILTROS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs text-slate-400">Parceiro</label>
                <select
                  name="parceiro"
                  defaultValue={parceiroFiltro ?? ''}
                  className="bg-surface border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
                >
                  <option value="">Todos</option>
                  <option value="wellhub">Wellhub</option>
                  <option value="totalpass">TotalPass</option>
                </select>
              </div>
              <button
                type="submit"
                className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
              >
                Filtrar
              </button>
              <Link href="/admin/wellhub" className="text-sm text-slate-400 hover:text-white">
                Limpar
              </Link>
            </form>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm">
              <Link
                href={monthHref(monthOffset - 1)}
                className="text-slate-400 hover:text-white"
              >
                ← mês anterior
              </Link>
              <span className="text-white font-medium capitalize">{monthLabel}</span>
              {monthOffset < 0 && (
                <Link
                  href={monthHref(monthOffset + 1)}
                  className="text-slate-400 hover:text-white"
                >
                  mês seguinte →
                </Link>
              )}
            </div>
            {comPendencia > 0 && <ChargeAllButton studentCount={comPendencia} />}
          </div>

          {rows.length === 0 ? (
            <Card>
              <p className="text-sm text-slate-400">
                {filtro === 'bloqueados'
                  ? 'Nenhum aluno bloqueado. 🎉'
                  : 'Ninguém com pendência de check-in. 🎉'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                O acompanhamento de check-ins de todos os alunos de parceiro está em{' '}
                <Link href="/admin/alunos" className="text-brand-400 hover:text-brand-300">
                  Alunos
                </Link>
                .
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <WellhubStudentRow key={r.studentId} {...r} />
              ))}
            </div>
          )}

          {/* Configuração é do dono: mexe em quanto se cobra e em quem é bloqueado. */}
          {isOwner && (
            <WellhubSettingsCard
              blockLimit={overview.blockLimit}
              price={overview.price}
              partnerRates={rates}
            />
          )}
        </>
      )}
    </div>
  )
}
