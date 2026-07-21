// features/aulas/gridActions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from './authGuards'
import { generateGrid } from './gridGeneration'
import { brtToday, addDaysStr, nextDateForDayOfWeek } from '@/lib/utils/gridSchedule'

interface GridActionResult {
  error?: string
  sessionsCreated?: number
  studentsBooked?: number
}

/** Gera a próxima ocorrência de um dia-da-semana (todas as turmas do dia). */
export async function generateGridDay(dayOfWeek: number): Promise<GridActionResult> {
  const { orgId, error } = await requireAdmin()
  if (error) return { error }

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return { error: 'Dia inválido.' }
  }

  const today = brtToday(new Date())
  const target = nextDateForDayOfWeek(today, dayOfWeek)
  const r = await generateGrid(orgId, target, target, { dayOfWeek })
  if (r.error) return { error: r.error }

  revalidatePath('/admin/grade')
  return { sessionsCreated: r.sessionsCreated, studentsBooked: r.studentsBooked }
}

/** Gera a semana toda (7 datas a partir de hoje, todas as turmas). */
export async function generateGridWeek(): Promise<GridActionResult> {
  const { orgId, error } = await requireAdmin()
  if (error) return { error }

  const from = brtToday(new Date())
  const to = addDaysStr(from, 6)
  const r = await generateGrid(orgId, from, to)
  if (r.error) return { error: r.error }

  revalidatePath('/admin/grade')
  return { sessionsCreated: r.sessionsCreated, studentsBooked: r.studentsBooked }
}
