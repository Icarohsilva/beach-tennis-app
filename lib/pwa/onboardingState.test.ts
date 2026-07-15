import { describe, it, expect } from 'vitest'
import { resolveOnboardingStep } from './onboardingState'

const base = {
  permission: 'default' as NotificationPermission,
  standalone: false,
  isIOS: false,
  installable: false,
  pushSupported: true,
}

describe('resolveOnboardingStep', () => {
  it('iOS não instalado → instalar primeiro', () => {
    expect(resolveOnboardingStep({ ...base, isIOS: true, pushSupported: false })).toBe('ios-install-first')
  })

  it('iOS instalado, permissão pendente → pedir permissão', () => {
    expect(resolveOnboardingStep({ ...base, isIOS: true, standalone: true })).toBe('enable-push')
  })

  it('iOS instalado, permissão concedida → escondido', () => {
    expect(resolveOnboardingStep({ ...base, isIOS: true, standalone: true, permission: 'granted' })).toBe('hidden')
  })

  it('Android instalável → oferecer instalação', () => {
    expect(resolveOnboardingStep({ ...base, installable: true })).toBe('install')
  })

  it('Android não instalável, permissão pendente → pedir permissão', () => {
    expect(resolveOnboardingStep({ ...base })).toBe('enable-push')
  })

  it('permissão negada → bloqueado', () => {
    expect(resolveOnboardingStep({ ...base, permission: 'denied' })).toBe('push-blocked')
  })

  it('desktop com permissão concedida e sem instalação → escondido', () => {
    expect(resolveOnboardingStep({ ...base, permission: 'granted' })).toBe('hidden')
  })

  it('nada suportado nem instalável → escondido', () => {
    expect(resolveOnboardingStep({ ...base, pushSupported: false })).toBe('hidden')
  })
})
