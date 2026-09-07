// features/aulas/classAudience.ts
// O admin pensa em "Tipo da turma" como 4 opções irmãs — Livre, Feminino,
// Masculino, Kids —, mas o banco guarda isso em dois campos ortogonais
// (`type`: kids/adult; `gender_restriction`: M/F/null) para não quebrar
// `lib/aulas/ageGroup.ts` (que compara `type` 1:1 com a faixa etária do
// aluno). Este módulo é a única tradução entre as duas visões, compartilhada
// por ClassForm.tsx e EditClassForm.tsx — duas cópias divergiriam do mesmo
// jeito que motivou lib/utils/attendees.ts e afins.
import type { ClassType, Gender } from '@/types'

export type Audience = 'livre' | 'feminino' | 'masculino' | 'kids'

export const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: 'livre', label: 'Livre' },
  { value: 'feminino', label: 'Feminino' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'kids', label: 'Kids' },
]

export function audienceOf(type: ClassType, genderRestriction: Gender | null): Audience {
  if (type === 'kids') return 'kids'
  if (genderRestriction === 'F') return 'feminino'
  if (genderRestriction === 'M') return 'masculino'
  return 'livre'
}

export function decodeAudience(audience: Audience): { type: ClassType; gender_restriction: Gender | null } {
  if (audience === 'kids') return { type: 'kids', gender_restriction: null }
  if (audience === 'feminino') return { type: 'adult', gender_restriction: 'F' }
  if (audience === 'masculino') return { type: 'adult', gender_restriction: 'M' }
  return { type: 'adult', gender_restriction: null }
}
