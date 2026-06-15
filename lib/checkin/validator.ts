import type { CheckinPartner } from '@/types'

export interface CheckinValidationInput {
  partner: CheckinPartner
  studentId: string
  partnerMemberId: string | null // wellhub_id / totalpass_id do perfil
  code?: string // código do app do parceiro (futuro)
}

export interface CheckinValidationResult {
  valid: boolean
  validation: 'manual' | CheckinPartner
  externalRef?: string
  error?: string
}

export interface CheckinValidator {
  validate(input: CheckinValidationInput): Promise<CheckinValidationResult>
}

/** Validador manual: usado quando o admin registra o check-in. Sempre válido. */
export const manualValidator: CheckinValidator = {
  async validate(input) {
    return { valid: true, validation: 'manual', externalRef: input.code }
  },
}

/**
 * Devolve o validador do parceiro. Hoje, manual para ambos.
 * No follow-up, retorna os adaptadores reais Wellhub/TotalPass.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getValidator(_partner: CheckinPartner): CheckinValidator {
  return manualValidator
}
