// app/(admin)/alunos/page.tsx
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDate } from '@/lib/utils/dateHelpers'
import { OccupancyBar } from '@/components/ui/OccupancyBar'
import { Users } from 'lucide-react'
import { computeProgress } from '@/lib/checkin/progress'
import { countDistinctDays } from '@/lib/checkin/monthlyProgress'
import { getOrgDefaultCheckinTarget } from '@/lib/checkin/orgCheckinTarget'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import { chunk, IN_CHUNK_SIZE } from '@/lib/supabase/paginate'
import type { Membership, StudentLevel } from '@/types'
import { CriarAlunoButton } from './CriarAlunoButton'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import { cn } from '@/lib/utils/cn'

const LEVEL_ORDER: StudentLevel[] = ['A', 'B', 'C', 'D', 'iniciante']

interface SearchParams {
  q?: string
  level?: string
  esporte?: string
  /** 'inativos' mostra só os cadastros inativados. Ausente = só os ativos. */
  situacao?: string
}

interface Props {
  searchParams: SearchParams
}

export const dynamic = 'force-dynamic'

export default async function AlunosPage({ searchParams }: Props) {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  const query = searchParams.q?.trim() ?? ''
  const levelFilter = searchParams.level ?? ''
  const orgSports = await getOrgSports(orgId)
  const sportFilter = orgSports.includes(searchParams.esporte ?? '') ? searchParams.esporte! : ''
  // Inativos são exceção: ficam fora por padrão e têm uma visão própria, em vez de
  // misturados com apagado visual na lista de todo dia.
  const showArchived = searchParams.situacao === 'inativos'

  // Campos por-academia vêm da membership da academia ativa (não de profiles):
  // um aluno multi-vínculo só aparece nesta lista se tiver membership nesta org,
  // e seus valores (nível, créditos, etc.) são os desta academia. A identidade
  // (full_name) vem de profiles via join.
  let dbQuery = adminClient
    .from('memberships')
    .select(
      'user_id, level, sports, payment_type, partner, contract_active, is_dependent, parent_id, credits_balance, pending_partner, monthly_checkin_target, archived_at, profiles:profiles!memberships_user_id_fkey!inner(full_name)',
    )
    .eq('role', 'student')
    .eq('organization_id', orgId)

  // Uma visão ou a outra, nunca as duas juntas: cadastro inativo apagadinho no meio
  // da lista de todo dia é convite a erro na chamada e na cobrança.
  dbQuery = showArchived
    ? dbQuery.not('archived_at', 'is', null)
    : dbQuery.is('archived_at', null)

  if (query) {
    dbQuery = dbQuery.ilike('profiles.full_name', `%${query}%`)
  }

  if (levelFilter && LEVEL_ORDER.includes(levelFilter as StudentLevel)) {
    dbQuery = dbQuery.eq('level', levelFilter)
  }

  if (sportFilter) {
    dbQuery = dbQuery.contains('sports', [sportFilter])
  }

  const { data: membershipsRaw } = await dbQuery

  // Identidade (full_name) + campos por-academia (Membership) de cada aluno.
  type StudentRow = {
    id: string
    full_name: string
    level: Membership['level']
    sports: Membership['sports']
    payment_type: Membership['payment_type']
    partner: Membership['partner']
    contract_active: Membership['contract_active']
    is_dependent: Membership['is_dependent']
    parent_id: Membership['parent_id']
    credits_balance: Membership['credits_balance']
    pending_partner: Membership['pending_partner']
    monthly_checkin_target: number
    archived_at: string | null
  }

  const students: StudentRow[] = (
    (membershipsRaw ?? []) as unknown as {
      user_id: string
      level: StudentLevel
      sports: string[] | null
      payment_type: Membership['payment_type']
      partner: Membership['partner']
      contract_active: boolean
      is_dependent: boolean
      parent_id: string | null
      credits_balance: number
      pending_partner: Membership['pending_partner']
      monthly_checkin_target: number | null
      archived_at: string | null
      profiles: { full_name: string } | { full_name: string }[] | null
    }[]
  )
    .map((m) => {
      const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return {
        id: m.user_id,
        full_name: prof?.full_name ?? '',
        level: m.level,
        sports: m.sports ?? [],
        payment_type: m.payment_type,
        partner: m.partner,
        contract_active: m.contract_active,
        is_dependent: m.is_dependent,
        parent_id: m.parent_id,
        credits_balance: m.credits_balance,
        pending_partner: m.pending_partner,
        monthly_checkin_target: m.monthly_checkin_target ?? 0,
        archived_at: m.archived_at,
      }
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))

  // Fetch active enrollments count per student
  const studentIds = students.map((s) => s.id)
  const { data: enrollmentsRaw } =
    studentIds.length > 0
      ? await adminClient
          .from('enrollments')
          .select('student_id')
          .in('student_id', studentIds)
          .eq('organization_id', orgId)
          .eq('is_active', true)
      : { data: [] }

  const enrollCountMap = new Map<string, number>()
  for (const e of (enrollmentsRaw ?? []) as { student_id: string }[]) {
    enrollCountMap.set(e.student_id, (enrollCountMap.get(e.student_id) ?? 0) + 1)
  }

  // Fetch active plan name per subscriber student
  const { data: subsRaw } =
    studentIds.length > 0
      ? await adminClient
          .from('student_subscriptions')
          .select('student_id, plan:subscription_plans(name)')
          .in('student_id', studentIds)
          .eq('organization_id', orgId)
          .eq('status', 'active')
      : { data: [] }

  const planNameMap = new Map<string, string>()
  for (const s of (subsRaw ?? []) as { student_id: string; plan: { name: string } | { name: string }[] | null }[]) {
    const planObj = Array.isArray(s.plan) ? s.plan[0] : s.plan
    if (planObj?.name) planNameMap.set(s.student_id, planObj.name)
  }

  // Progresso de check-in do mês dos alunos de parceiro — é aqui que o professor
  // acompanha quem está longe da meta (a tela de Controle Wellhub cuida só de quem
  // já virou pendência). Uma query para todos, agrupada por aluno.
  const partnerIds = students.filter((s) => s.partner).map((s) => s.id)
  const monthWindow = getMonthWindow(new Date())

  const { data: checkinsRaw } =
    partnerIds.length > 0
      ? await adminClient
          .from('checkins')
          .select('student_id, checkin_date')
          .eq('organization_id', orgId)
          .in('student_id', partnerIds)
          .gte('checkin_date', monthWindow.from)
          .lte('checkin_date', monthWindow.to)
      : { data: [] }

  const checkinDatesByStudent = new Map<string, { checkin_date: string }[]>()
  for (const c of (checkinsRaw ?? []) as { student_id: string; checkin_date: string }[]) {
    checkinDatesByStudent.set(c.student_id, [
      ...(checkinDatesByStudent.get(c.student_id) ?? []),
      { checkin_date: c.checkin_date },
    ])
  }

  // Nome do responsável de cada dependente: "Dependente" solto não dizia de quem,
  // e o admin tinha que abrir a ficha para descobrir. `parent_id` já vinha na
  // query acima e nunca era usado.
  const parentIds = Array.from(
    new Set(students.filter((s) => s.is_dependent && s.parent_id).map((s) => s.parent_id!)),
  )
  const parentNameById = new Map<string, string>()
  for (const ids of chunk(parentIds, IN_CHUNK_SIZE)) {
    const { data: parentsRaw } = await adminClient
      .from('profiles')
      .select('id, full_name')
      .in('id', ids)
    for (const p of (parentsRaw ?? []) as { id: string; full_name: string }[]) {
      parentNameById.set(p.id, p.full_name)
    }
  }

  // Meta padrão da academia para quem não tem meta própria — mesma regra da ficha do
  // aluno e do Controle Wellhub, senão o card mostraria "3 / 0".
  const orgDefaultTarget =
    partnerIds.length > 0 && orgId
      ? await getOrgDefaultCheckinTarget(adminClient, orgId)
      : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-white">
          {showArchived ? 'Alunos inativos' : 'Alunos'}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-400">
            {students.length} {showArchived ? 'inativo' : 'aluno'}
            {students.length !== 1 ? 's' : ''}
          </span>
          {!showArchived && <CriarAlunoButton orgSports={orgSports} />}
        </div>
      </div>

      {/* Alternância ativos/inativos. Preserva os filtros já aplicados: o admin que
          buscou um nome e não achou quer justamente conferir se saiu da academia. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href={`/admin/alunos?${new URLSearchParams({
            ...(query ? { q: query } : {}),
            ...(levelFilter ? { level: levelFilter } : {}),
            ...(sportFilter ? { esporte: sportFilter } : {}),
          })}`}
          className={
            'rounded-full px-3 py-1.5 font-semibold transition-colors ' +
            (showArchived
              ? 'border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:text-white'
              : 'bg-brand-600 text-white')
          }
        >
          Ativos
        </Link>
        <Link
          href={`/admin/alunos?${new URLSearchParams({
            situacao: 'inativos',
            ...(query ? { q: query } : {}),
            ...(levelFilter ? { level: levelFilter } : {}),
            ...(sportFilter ? { esporte: sportFilter } : {}),
          })}`}
          className={
            'rounded-full px-3 py-1.5 font-semibold transition-colors ' +
            (showArchived
              ? 'bg-brand-600 text-white'
              : 'border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:text-white')
          }
        >
          Inativos
        </Link>
      </div>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-3 items-end">
        {/* Sem isto, filtrar por nome dentro da visão de inativos jogaria o admin de
            volta para a lista de ativos e o resultado pareceria "não existe". */}
        {showArchived && <input type="hidden" name="situacao" value="inativos" />}
        <div className="flex-1 min-w-48">
          <label className="block text-xs text-slate-400 mb-1">Buscar por nome</label>
          <input
            name="q"
            defaultValue={query}
            placeholder="Nome do aluno..."
            className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Nível</label>
          <select
            name="level"
            defaultValue={levelFilter}
            className="bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="">Todos</option>
            {LEVEL_ORDER.map((l) => (
              <option key={l} value={l}>
                {l === 'iniciante' ? 'Iniciante' : `Nível ${l}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Esporte</label>
          <select
            name="esporte"
            defaultValue={sportFilter}
            className="bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="">Todos</option>
            {orgSports.map((slug) => (
              <option key={slug} value={slug}>
                {sportLabel(slug)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-xl transition-colors"
        >
          Filtrar
        </button>
        {(query || levelFilter || sportFilter) && (
          <Link
            href="/admin/alunos"
            className="px-4 py-2 border border-surface-border text-slate-400 hover:text-white text-sm rounded-xl transition-colors"
          >
            Limpar
          </Link>
        )}
      </form>

      {/* Student list */}
      {students.length === 0 ? (
        <EmptyState
          icon={Users}
          title={showArchived ? 'Nenhum cadastro inativo.' : 'Nenhum aluno encontrado.'}
          description={
            showArchived
              ? 'Alunos que saírem da academia aparecem aqui e podem ser reativados.'
              : 'Tente ajustar os filtros ou cadastre um novo aluno.'
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {students.map((student) => {
            const enrollCount = enrollCountMap.get(student.id) ?? 0
            // Dias distintos, não linhas: duas aulas no mesmo dia contam 1 para a
            // meta (spec 2026-07-29-checkin-diario-unico).
            const checkinProgress = student.partner
              ? computeProgress(
                  student.monthly_checkin_target > 0
                    ? student.monthly_checkin_target
                    : orgDefaultTarget,
                  countDistinctDays(checkinDatesByStudent.get(student.id) ?? []),
                )
              : null

            return (
              <Link key={student.id} href={`/admin/alunos/${student.id}`}>
                <Card className="hover:border-brand-600/50 transition-colors cursor-pointer h-full">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <p className="text-white font-medium text-sm truncate">{student.full_name}</p>
                      {student.archived_at && (
                        <span className="mt-0.5 inline-block rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-300">
                          Inativo desde {formatDate(student.archived_at)}
                        </span>
                      )}
                      {student.is_dependent && (
                        // Nome do responsável em vez de "Dependente" solto: é o que
                        // permite identificar de quem é a criança sem abrir a ficha.
                        // Texto, não link — o card inteiro já é um <Link>.
                        <span className="block truncate text-xs text-slate-500">
                          {student.parent_id && parentNameById.get(student.parent_id)
                            ? `Dependente de ${parentNameById.get(student.parent_id)}`
                            : 'Dependente'}
                        </span>
                      )}
                      {student.pending_partner && (
                        <span className="block text-xs text-yellow-400 mt-0.5">
                          Parceiro pendente
                        </span>
                      )}
                    </div>
                  </div>

                  {student.sports.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {student.sports.map((slug) => (
                        <span
                          key={slug}
                          className="text-[11px] rounded-full border border-surface-border bg-surface px-2 py-0.5 text-slate-300"
                        >
                          {sportEmoji(slug)} {sportLabel(slug)}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="space-y-1 text-xs text-slate-400">
                    <div className="flex items-start justify-between gap-2">
                      <span className="shrink-0">Plano</span>
                      <span
                        className={cn(
                          'min-w-0 break-words text-right',
                          student.payment_type !== 'subscriber' || student.contract_active
                            ? 'text-green-400'
                            : 'text-red-400',
                        )}
                      >
                        {student.payment_type === 'subscriber'
                          ? (planNameMap.get(student.id) ?? 'Mensalista (sem plano)')
                          : 'Avulso'}
                        {student.payment_type === 'subscriber' && !student.contract_active && ' (inativo)'}
                      </span>
                    </div>
                    {student.partner && (
                      <div className="flex items-start justify-between gap-2">
                        <span className="shrink-0">Parceiro</span>
                        <span className="shrink-0 text-brand-500">
                          {student.partner === 'wellhub' ? 'Wellhub' : 'TotalPass'}
                        </span>
                      </div>
                    )}
                    {student.partner && checkinProgress && (
                      <div className="pt-1">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="min-w-0 truncate">Check-ins no mês</span>
                          <span
                            className={cn(
                              'shrink-0',
                              checkinProgress.remaining === 0 ? 'text-green-400' : 'text-white',
                            )}
                          >
                            {checkinProgress.done} / {checkinProgress.target}
                          </span>
                        </div>
                        <OccupancyBar
                          booked={checkinProgress.done}
                          capacity={Math.max(checkinProgress.target, 1)}
                        />
                        {checkinProgress.remaining > 0 ? (
                          <p className="mt-1 text-[11px] text-yellow-400">
                            faltam {checkinProgress.remaining} para a meta
                          </p>
                        ) : checkinProgress.ahead > 0 ? (
                          <p className="mt-1 text-[11px] text-green-400">
                            {checkinProgress.ahead} acima da meta
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-green-400">meta batida</p>
                        )}
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <span className="shrink-0">Turmas fixas</span>
                      <span className="text-white">{enrollCount}</span>
                    </div>
                    {student.payment_type === 'subscriber' && (
                      <div className="flex items-start justify-between gap-2">
                        <span className="shrink-0">Créditos</span>
                        <span
                          className={cn(
                            'shrink-0',
                            student.credits_balance > 0 ? 'text-white' : 'text-slate-500',
                          )}
                        >
                          {student.credits_balance}
                        </span>
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
