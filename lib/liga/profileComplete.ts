// lib/liga/profileComplete.ts
// A régua do "cadastro completo" que vale o bônus da Liga.
//
// Existe separada porque DOIS lugares precisam dela e não podem discordar: o motor que
// concede o ponto (`checkProfileComplete`) e a tela que diz ao aluno o que falta. Duas
// cópias da mesma regra divergem no primeiro ajuste, e quando divergem o app promete um
// ponto que não paga — que foi exatamente o defeito que originou este arquivo.

export interface ProfileFieldsInput {
  phone: string | null
  emergencyName: string | null
  emergencyPhone: string | null
  /** Modalidades que o aluno declarou praticar nesta academia. */
  declaredSports: string[]
  /** Quantas modalidades a academia oferece. Uma só = não há o que escolher. */
  orgSportsCount: number
}

function preenchido(valor: string | null): boolean {
  return !!valor?.trim()
}

/**
 * O que ainda falta, em rótulos prontos para a tela.
 *
 * A régua é o mínimo que a academia precisa para operar: telefone para chamar e contato
 * de emergência para o caso de acidente na quadra. Nada de foto ou endereço, que a
 * academia não usa — exigir o que ninguém consulta transforma o bônus em burocracia.
 *
 * A modalidade só é exigida onde ela é escolha de verdade. Numa academia com uma
 * modalidade só, o ponto iria para esse mesmo esporte de qualquer jeito, e pedir que o
 * aluno a declare fazia quem preencheu tudo o que a tela pede ficar sem o bônus.
 */
export function missingProfileFields(input: ProfileFieldsInput): string[] {
  const faltando: string[] = []

  if (!preenchido(input.phone)) faltando.push('Telefone / WhatsApp')
  if (!preenchido(input.emergencyName)) faltando.push('Nome do contato de emergência')
  if (!preenchido(input.emergencyPhone)) faltando.push('Telefone do contato de emergência')
  if (input.declaredSports.length === 0 && input.orgSportsCount > 1) {
    faltando.push('Suas modalidades')
  }

  return faltando
}

export function isProfileComplete(input: ProfileFieldsInput): boolean {
  return missingProfileFields(input).length === 0
}
