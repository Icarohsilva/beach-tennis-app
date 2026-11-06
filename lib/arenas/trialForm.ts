// lib/arenas/trialForm.ts
// Validação do formulário da aula experimental. Pura: a action
// (app/arenas/[slug]/actions.ts) e os testes leem daqui.
//
// A experimental cria a conta de quem marca (com vínculo na academia, sem plano),
// então o formulário de quem não está logado é o de um cadastro: nome, e-mail,
// WhatsApp, sexo e senha. O CPF vale para os dois casos, logado ou não, porque é
// ele que garante uma experimental por pessoa em cada academia.
import type { Gender } from '@/types'
import { isValidCPF, onlyDigits } from '@/lib/validation/documento'
import { parseWhatsApp } from '@/lib/utils/phone'

export const TRIAL_CPF_USED_MESSAGE =
  'Este CPF já tem uma aula experimental nesta academia. Para continuar treinando, escolha um plano ou compre créditos no app.'

/** CPF só com dígitos, ou o erro para mostrar. */
export function parseTrialCpf(raw: string): { ok: true; cpf: string } | { ok: false; error: string } {
  const cpf = onlyDigits(raw)
  if (!cpf) return { ok: false, error: 'Informe seu CPF.' }
  if (cpf.length !== 11 || !isValidCPF(cpf)) return { ok: false, error: 'CPF inválido. Confira os números.' }
  return { ok: true, cpf }
}

export interface NewTrialAccountInput {
  name?: string
  email?: string
  phone?: string
  password?: string
  gender?: string | null
}

export interface NewTrialAccount {
  name: string
  email: string
  /** Formatado "(31) 99999-9999", como os outros cadastros gravam em profiles.phone. */
  phone: string
  password: string
  gender: Gender
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Campos da conta nova de quem não está logado. */
export function parseNewTrialAccount(
  input: NewTrialAccountInput,
): { ok: true; value: NewTrialAccount } | { ok: false; error: string } {
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ')
  if (name.split(' ').length < 2) return { ok: false, error: 'Informe seu nome completo.' }
  const email = (input.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'E-mail inválido.' }
  const phone = parseWhatsApp(input.phone ?? '')
  if (!phone.ok) return { ok: false, error: phone.error }
  if (input.gender !== 'M' && input.gender !== 'F') return { ok: false, error: 'Informe seu sexo.' }
  const password = input.password ?? ''
  if (password.length < 6) return { ok: false, error: 'A senha precisa ter pelo menos 6 caracteres.' }
  return { ok: true, value: { name, email, phone: phone.formatted, password, gender: input.gender } }
}
