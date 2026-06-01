// lib/utils/levelAccess.ts
import type { StudentLevel } from '@/types'

// Higher index = more advanced. A=4 (most advanced), iniciante=0 (most basic)
export const LEVEL_HIERARCHY: Record<StudentLevel, number> = {
  iniciante: 0,
  D: 1,
  C: 2,
  B: 3,
  A: 4,
}

/** Student can attend a class if their level >= class level (numerically) */
export function canStudentAttendLevel(
  studentLevel: StudentLevel,
  classLevel: StudentLevel,
): boolean {
  return LEVEL_HIERARCHY[studentLevel] >= LEVEL_HIERARCHY[classLevel]
}
