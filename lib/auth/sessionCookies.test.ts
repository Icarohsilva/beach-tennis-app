import { describe, it, expect } from 'vitest'
import { hasSessionCookie } from './sessionCookies'

const BASE = 'sb-fmzgsgwphsvkshzcnbwa-auth-token'

describe('hasSessionCookie', () => {
  it('reconhece o cookie de sessão', () => {
    expect(hasSessionCookie([BASE])).toBe(true)
  })

  it('reconhece sessão fragmentada em .0/.1', () => {
    expect(hasSessionCookie([`${BASE}.0`, `${BASE}.1`])).toBe(true)
  })

  it('NÃO conta o code-verifier do PKCE como sessão', () => {
    // Esse cookie nasce quando um visitante DESLOGADO pede recuperação de senha.
    // Contá-lo como sessão deixa passar pelo portão do middleware quem não tem login.
    expect(hasSessionCookie([`${BASE}-code-verifier`])).toBe(false)
  })

  it('reconhece a sessão mesmo com o code-verifier presente', () => {
    expect(hasSessionCookie([`${BASE}-code-verifier`, BASE])).toBe(true)
  })

  it('ignora cookies de terceiros', () => {
    expect(hasSessionCookie(['arenahub_active_org', '_vercel_jwt'])).toBe(false)
  })
})
