import { describe, it, expect } from 'vitest'
import { resolvePrompt, DISMISS_WINDOW_MS, type PromptInput } from './promptState'

const NOW = 1_800_000_000_000

// Celular Android genérico, nada instalado, permissão ainda não pedida.
const base: PromptInput = {
  isMobile: true,
  isIOS: false,
  isInAppBrowser: false,
  standalone: false,
  installable: false,
  pushSupported: true,
  permission: 'default',
  dismissedAt: null,
  now: NOW,
}

describe('resolvePrompt', () => {
  it('desktop nunca vê nada', () => {
    expect(resolvePrompt({ ...base, isMobile: false })).toBe('none')
    expect(resolvePrompt({ ...base, isMobile: false, installable: true })).toBe('none')
    expect(resolvePrompt({ ...base, isMobile: false, permission: 'denied' })).toBe('none')
  })

  it('instalado + permissão concedida → nada', () => {
    expect(resolvePrompt({ ...base, standalone: true, permission: 'granted' })).toBe('none')
  })

  it('instalado + permissão pendente → pede push', () => {
    expect(resolvePrompt({ ...base, standalone: true })).toBe('push-ask')
  })

  it('instalado + permissão negada → explica como desbloquear', () => {
    expect(resolvePrompt({ ...base, standalone: true, permission: 'denied' })).toBe('push-blocked')
  })

  it('iOS não instalado → sheet de instalação', () => {
    expect(resolvePrompt({ ...base, isIOS: true, pushSupported: false })).toBe('install-ios')
  })

  it('iOS dentro de in-app browser → manda abrir no Safari', () => {
    expect(resolvePrompt({ ...base, isIOS: true, isInAppBrowser: true })).toBe('install-ios-inapp')
  })

  it('iOS não instalado nunca pede push, mesmo com permissão negada', () => {
    // No iOS push só existe depois de instalar: pedir antes confunde.
    expect(resolvePrompt({ ...base, isIOS: true, permission: 'denied' })).toBe('install-ios')
  })

  it('Android instalável → sheet com botão nativo', () => {
    expect(resolvePrompt({ ...base, installable: true })).toBe('install-android')
  })

  it('Android sem beforeinstallprompt cai para push', () => {
    expect(resolvePrompt({ ...base, installable: false })).toBe('push-ask')
  })

  it('sem suporte a push e sem instalação possível → nada', () => {
    expect(resolvePrompt({ ...base, pushSupported: false })).toBe('none')
  })

  it('dispensado há menos de 24h esconde o sheet', () => {
    const recente = NOW - (DISMISS_WINDOW_MS - 1000)
    expect(resolvePrompt({ ...base, isIOS: true, dismissedAt: recente })).toBe('none')
    expect(resolvePrompt({ ...base, installable: true, dismissedAt: recente })).toBe('none')
  })

  it('dispensado há mais de 24h mostra o sheet de novo', () => {
    const antigo = NOW - (DISMISS_WINDOW_MS + 1000)
    expect(resolvePrompt({ ...base, isIOS: true, dismissedAt: antigo })).toBe('install-ios')
    expect(resolvePrompt({ ...base, installable: true, dismissedAt: antigo })).toBe('install-android')
  })

  it('dispensa não silencia o aviso de push', () => {
    // A faixa não é dispensável: só some quando a permissão for concedida.
    expect(resolvePrompt({ ...base, standalone: true, dismissedAt: NOW })).toBe('push-ask')
  })

  it('dispensa não silencia o "abra no Safari"', () => {
    // Não é um convite, é um beco sem saída: precisa aparecer sempre.
    expect(
      resolvePrompt({ ...base, isIOS: true, isInAppBrowser: true, dismissedAt: NOW }),
    ).toBe('install-ios-inapp')
  })
})
