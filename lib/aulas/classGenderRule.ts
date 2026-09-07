// lib/aulas/classGenderRule.ts
// Turma com restrição de sexo (Feminino/Masculino) só aceita quem bate. Turma
// Livre (restriction null) aceita qualquer um. Mesmo padrão de accessRules.ts:
// puro, sem I/O — quem busca profiles.gender/classes.gender_restriction é o
// caller, replicado nas mesmas 4 portas de entrada do corte Kids (bookSessionAs,
// joinWaitlistAs, addStudentToSession, enrollStudentInClass).
import type { Gender } from '@/types'

/**
 * O aluno pode entrar nesta turma?
 *
 * Sexo desconhecido (`studentGender: null`) NÃO entra em turma restrita — a
 * maioria dos alunos ainda não preencheu esse campo (só /perfil coleta), e
 * deixar passar por omissão anularia a própria restrição que a academia pediu.
 */
export function canEnterByGender(
  studentGender: Gender | null,
  restriction: Gender | null,
): boolean {
  if (restriction === null) return true
  return studentGender === restriction
}

const GENDER_LABEL: Record<Gender, string> = { M: 'masculino', F: 'feminino' }

/**
 * Mensagem de recusa, pronta para o aluno ler.
 *
 * Duas causas, duas mensagens: sexo incompatível (ele sabe qual é o dele, só não
 * bate) e sexo desconhecido (o cadastro não tem essa informação ainda — a saída
 * é completar o perfil, não uma recusa sem próximo passo).
 */
export function classGenderDenialMessage(
  restriction: Gender,
  studentGenderKnown: boolean,
): string {
  if (!studentGenderKnown) {
    return 'Complete seu sexo no seu perfil para entrar nesta turma.'
  }
  return `Esta turma é exclusiva para o público ${GENDER_LABEL[restriction]}.`
}
