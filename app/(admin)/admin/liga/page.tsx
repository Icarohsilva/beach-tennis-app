// app/(admin)/admin/liga/page.tsx
// Painel da Liga para a academia: ranking da temporada e bônus manual.
//
// Não é owner-only de propósito: quem convive com o aluno e reconhece o destaque da
// aula é o professor, e awardLigaBonus já autoriza qualquer admin da academia.
import { createAdminClient, getCurrentOrgId, getStaffContext } from '@/lib/supabase/server'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { Card } from '@/components/ui/Card'
import { getOrgSports } from '@/lib/arenas/orgSports'
import { sportLabel } from '@/lib/arenas/sports'
import { getLigaSettings } from '@/features/liga/settings'
import { getOrCreateActiveSeason } from '@/features/liga/season'
import { DIVISION_LABEL } from '@/lib/liga/labels'
import { formatDate } from '@/lib/utils/dateHelpers'
import { LigaBonusForm } from './LigaBonusForm'
import type { LigaDivision } from '@/types'

export const dynamic = 'force-dynamic'

interface StandingRow {
  student_id: string
  sport: string
  division: LigaDivision
  points: number
}

export default async function AdminLigaPage() {
  await requirePlatformAccess()
  const staff = await getStaffContext()

  const admin = createAdminClient()
  const orgId = await getCurrentOrgId()
  if (!orgId || !staff) return null

  const [settings, orgSports] = await Promise.all([getLigaSettings(orgId), getOrgSports(orgId)])

  if (!settings.enabled) {
    return (
      <div className="space-y-6 max-w-lg">
        <div>
          <h1 className="text-2xl font-bold text-white">Liga</h1>
          <p className="text-slate-400 text-sm mt-1">Ranking de temporada dos seus alunos</p>
        </div>
        <Card>
          <p className="text-sm text-slate-300">
            A Liga está desligada. Ative em <span className="text-brand-500">Configurações</span>{' '}
            para começar a pontuar presença, torneios e bônus.
          </p>
        </Card>
      </div>
    )
  }

  const season = await getOrCreateActiveSeason(orgId)

  // Turmas sem modalidade não pontuam (lib/liga/sportForPoints.ts). Só é problema
  // quando a academia tem mais de uma modalidade — com uma só, o fallback resolve.
  const { count: classesWithoutSport } = await admin
    .from('classes')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .is('sport', null)

  const { data: standingsRaw } = season
    ? await admin
        .from('liga_standings')
        .select('student_id, sport, division, points')
        .eq('season_id', season.id)
        .order('points', { ascending: false })
    : { data: [] }

  const standings = (standingsRaw ?? []) as StandingRow[]

  const { data: membersRaw } = await admin
    .from('memberships')
    .select('user_id, profiles:profiles!memberships_user_id_fkey!inner(full_name)')
    .eq('organization_id', orgId)
    .eq('role', 'student')

  const members = (
    (membersRaw ?? []) as {
      user_id: string
      profiles: { full_name: string } | { full_name: string }[] | null
    }[]
  )
    .map((m) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return { id: m.user_id, name: p?.full_name ?? 'Aluno' }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

  const nameById = new Map(members.map((m) => [m.id, m.name]))

  const bySport = new Map<string, StandingRow[]>()
  for (const row of standings) {
    const list = bySport.get(row.sport) ?? []
    list.push(row)
    bySport.set(row.sport, list)
  }

  return (
    <div className="space-y-8 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-white">Liga</h1>
        <p className="text-slate-400 text-sm mt-1">
          {season
            ? `Temporada de ${formatDate(season.starts_on)} a ${formatDate(season.ends_on)}`
            : 'Sem temporada aberta'}
        </p>
      </div>

      {(classesWithoutSport ?? 0) > 0 && orgSports.length > 1 && (
        <Card>
          <p className="text-sm text-amber-300">
            {classesWithoutSport}{' '}
            {classesWithoutSport === 1
              ? 'turma ativa sem modalidade não está pontuando'
              : 'turmas ativas sem modalidade não estão pontuando'}{' '}
            na Liga. Defina a modalidade na Grade de Aulas para que a presença conte.
          </p>
        </Card>
      )}

      <div>
        <h2 className="text-lg font-bold text-white">Dar bônus</h2>
        <p className="text-slate-400 text-sm mt-1">
          Pontos por algo que o sistema não vê: destaque da aula, evolução, ajudou a montar a
          quadra.
        </p>
      </div>
      <LigaBonusForm students={members} sports={orgSports} />

      <div>
        <h2 className="text-lg font-bold text-white">Ranking</h2>
      </div>
      {bySport.size === 0 ? (
        <Card>
          <p className="text-sm text-slate-300">Ninguém pontuou nesta temporada ainda.</p>
        </Card>
      ) : (
        Array.from(bySport.entries()).map(([sport, rows]) => (
          <Card key={sport}>
            <p className="text-xs text-slate-400 tracking-wide mb-3">
              {sportLabel(sport).toUpperCase()}
            </p>
            <ul className="space-y-1.5">
              {rows.map((r, i) => (
                <li key={`${r.student_id}-${r.sport}`} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-xs text-slate-400">{i + 1}</span>
                  <span className="flex-1 truncate text-slate-200">
                    {nameById.get(r.student_id) ?? 'Aluno'}
                  </span>
                  <span className="text-xs text-slate-500">{DIVISION_LABEL[r.division]}</span>
                  <span className="text-xs text-brand-500 font-medium w-10 text-right">
                    {r.points}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  )
}
