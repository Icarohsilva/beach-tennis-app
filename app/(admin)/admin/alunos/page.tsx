// app/(admin)/alunos/page.tsx
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Users } from 'lucide-react'
import type { Membership, StudentLevel } from '@/types'
import { CriarAlunoButton } from './CriarAlunoButton'

const LEVEL_ORDER: StudentLevel[] = ['A', 'B', 'C', 'D', 'iniciante']

interface SearchParams {
  q?: string
  level?: string
}

interface Props {
  searchParams: SearchParams
}

export const dynamic = 'force-dynamic'

export default async function AlunosPage({ searchParams }: Props) {
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  const query = searchParams.q?.trim() ?? ''
  const levelFilter = searchParams.level ?? ''

  // Campos por-academia vêm da membership da academia ativa (não de profiles):
  // um aluno multi-vínculo só aparece nesta lista se tiver membership nesta org,
  // e seus valores (nível, créditos, etc.) são os desta academia. A identidade
  // (full_name) vem de profiles via join.
  let dbQuery = adminClient
    .from('memberships')
    .select(
      'user_id, level, payment_type, contract_active, is_dependent, parent_id, credits_balance, pending_partner, profiles:profiles!memberships_user_id_fkey!inner(full_name)',
    )
    .eq('role', 'student')
    .eq('organization_id', orgId)

  if (query) {
    dbQuery = dbQuery.ilike('profiles.full_name', `%${query}%`)
  }

  if (levelFilter && LEVEL_ORDER.includes(levelFilter as StudentLevel)) {
    dbQuery = dbQuery.eq('level', levelFilter)
  }

  const { data: membershipsRaw } = await dbQuery

  // Identidade (full_name) + campos por-academia (Membership) de cada aluno.
  type StudentRow = {
    id: string
    full_name: string
    level: Membership['level']
    payment_type: Membership['payment_type']
    contract_active: Membership['contract_active']
    is_dependent: Membership['is_dependent']
    parent_id: Membership['parent_id']
    credits_balance: Membership['credits_balance']
    pending_partner: Membership['pending_partner']
  }

  const students: StudentRow[] = (
    (membershipsRaw ?? []) as unknown as {
      user_id: string
      level: StudentLevel
      payment_type: Membership['payment_type']
      contract_active: boolean
      is_dependent: boolean
      parent_id: string | null
      credits_balance: number
      pending_partner: Membership['pending_partner']
      profiles: { full_name: string } | { full_name: string }[] | null
    }[]
  )
    .map((m) => {
      const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return {
        id: m.user_id,
        full_name: prof?.full_name ?? '',
        level: m.level,
        payment_type: m.payment_type,
        contract_active: m.contract_active,
        is_dependent: m.is_dependent,
        parent_id: m.parent_id,
        credits_balance: m.credits_balance,
        pending_partner: m.pending_partner,
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

  const paymentLabel: Record<string, string> = {
    subscriber: 'Mensalista',
    per_class: 'Avulso',
    wellhub: 'Wellhub',
    totalpass: 'Totalpass',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Alunos</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">{students.length} alunos</span>
          <CriarAlunoButton />
        </div>
      </div>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-3 items-end">
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
        <button
          type="submit"
          className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-xl transition-colors"
        >
          Filtrar
        </button>
        {(query || levelFilter) && (
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
        <EmptyState icon={Users} title="Nenhum aluno encontrado." description="Tente ajustar os filtros ou cadastre um novo aluno." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {students.map((student) => {
            const enrollCount = enrollCountMap.get(student.id) ?? 0

            return (
              <Link key={student.id} href={`/admin/alunos/${student.id}`}>
                <Card className="hover:border-brand-600/50 transition-colors cursor-pointer h-full">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <p className="text-white font-medium text-sm truncate">{student.full_name}</p>
                      {student.is_dependent && (
                        <span className="text-xs text-slate-500">Dependente</span>
                      )}
                      {student.pending_partner && (
                        <span className="block text-xs text-yellow-400 mt-0.5">
                          Parceiro pendente
                        </span>
                      )}
                    </div>
                    <Badge variant="level">{student.level.toUpperCase()}</Badge>
                  </div>

                  <div className="space-y-1 text-xs text-slate-400">
                    <div className="flex items-center justify-between">
                      <span>Plano</span>
                      <span className={student.contract_active ? 'text-green-400' : 'text-red-400'}>
                        {student.payment_type === 'subscriber'
                          ? (planNameMap.get(student.id) ?? 'Mensalista (sem plano)')
                          : (paymentLabel[student.payment_type] ?? student.payment_type)}
                        {!student.contract_active && ' (inativo)'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Turmas fixas</span>
                      <span className="text-white">{enrollCount}</span>
                    </div>
                    {student.payment_type === 'subscriber' && (
                      <div className="flex items-center justify-between">
                        <span>Créditos</span>
                        <span className={student.credits_balance > 0 ? 'text-white' : 'text-slate-500'}>
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
