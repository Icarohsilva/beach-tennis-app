// lib/aulas/ageGroup.ts
// Aluno adulto/kids contra turma adulto/kids.
//
// Regra pura porque o mesmo aviso aparece em três telas (chamada, ficha do aluno e
// lista da turma) e o texto precisa ser o mesmo nas três — cada uma escrevendo o seu
// é como as versões divergem.
//
// AVISO, nunca bloqueio: o corte de idade é convenção da academia, e sempre existe o
// caso legítimo (o adolescente que treina com os adultos, a mãe que entra na turma da
// filha). Bloquear transformaria uma exceção comum em chamado de suporte.
import type { AgeGroup, ClassType } from '@/types'

export const AGE_GROUP_LABEL: Record<AgeGroup, string> = {
  adult: 'Adulto',
  kids: 'Kids',
}

export function ageGroupMatchesClass(student: AgeGroup, classType: ClassType): boolean {
  return student === classType
}

/**
 * O aviso, ou null quando bate.
 *
 * Diz o que está desencontrado em vez de só "incompatível": quem lê está decidindo se
 * foi engano ou exceção, e para isso precisa saber qual é qual.
 */
export function ageGroupWarning(student: AgeGroup, classType: ClassType): string | null {
  if (ageGroupMatchesClass(student, classType)) return null
  return student === 'kids'
    ? 'Aluno kids numa turma de adulto'
    : 'Aluno adulto numa turma kids'
}
