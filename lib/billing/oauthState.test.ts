// lib/billing/oauthState.test.ts
import { describe, it, expect } from 'vitest'
import { createOAuthState, verifyOAuthState } from './oauthState'

const SECRET = 'app-secret-de-teste'
const NOW = 1_800_000_000_000

describe('oauthState', () => {
  it('roundtrip create → verify', () => {
    const state = createOAuthState({ orgId: 'org-1', userId: 'user-1' }, SECRET, NOW)
    expect(verifyOAuthState(state, SECRET, NOW + 1000)).toEqual({ orgId: 'org-1', userId: 'user-1' })
  })

  it('expira após 10 minutos', () => {
    const state = createOAuthState({ orgId: 'org-1', userId: 'user-1' }, SECRET, NOW)
    expect(verifyOAuthState(state, SECRET, NOW + 10 * 60 * 1000 + 1)).toBeNull()
  })

  it('assinatura adulterada → null', () => {
    const state = createOAuthState({ orgId: 'org-1', userId: 'user-1' }, SECRET, NOW)
    const [body] = state.split('.')
    expect(verifyOAuthState(`${body}.assinatura-falsa`, SECRET, NOW)).toBeNull()
  })

  it('secret diferente → null', () => {
    const state = createOAuthState({ orgId: 'org-1', userId: 'user-1' }, SECRET, NOW)
    expect(verifyOAuthState(state, 'outro-secret', NOW)).toBeNull()
  })

  it('malformado/vazio → null', () => {
    expect(verifyOAuthState('lixo', SECRET, NOW)).toBeNull()
    expect(verifyOAuthState(null, SECRET, NOW)).toBeNull()
    expect(verifyOAuthState(undefined, SECRET, NOW)).toBeNull()
  })
})
