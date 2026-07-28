// lib/auth/sessionCookies.ts
// Nomes de cookie do Supabase Auth. Usado pelo middleware (Edge Runtime) — mantenha
// puro, sem import de @supabase/*.
//
// A sessão mora em sb-<ref>-auth-token e, quando grande, é FRAGMENTADA em
// sb-<ref>-auth-token.0, .1, ... (por isso includes e não endsWith).
// Já sb-<ref>-auth-token-code-verifier é o code_verifier do fluxo PKCE: ele nasce
// quando alguém DESLOGADO pede recuperação de senha e some depois da troca. Ele casa
// com o mesmo prefixo/sufixo da sessão, então precisa ser excluído explicitamente —
// senão quem só pediu "esqueci minha senha" passa pelo portão do middleware sem login.
const CODE_VERIFIER_MARKER = '-code-verifier'

export function isSessionCookieName(name: string): boolean {
  if (!name.startsWith('sb-') || !name.includes('-auth-token')) return false
  return !name.includes(CODE_VERIFIER_MARKER)
}

export function hasSessionCookie(names: string[]): boolean {
  return names.some(isSessionCookieName)
}

// Marcador de "acabei de validar um link de recuperação". Quem libera o formulário de
// nova senha é ESTE cookie somado a uma sessão válida — nunca a sessão sozinha, senão
// uma sessão antiga no navegador faria o usuário trocar a senha da conta errada.
// Não é credencial: a troca em si continua exigindo a sessão do Supabase.
export const RECOVERY_COOKIE = 'arenahub_recovery'
export const RECOVERY_COOKIE_MAX_AGE = 15 * 60
