// lib/version.ts
// Identidade da build e as duas regras de "o cliente está velho?".
//
// PURO e SEM IMPORTS de propósito: o middleware roda no Edge Runtime e importa este
// arquivo. A mesma restrição que o cabeçalho de middleware.ts documenta para
// lib/auth/sessionCookies.ts vale aqui.

/**
 * Identificador da build que ESTE bundle está rodando.
 *
 * Vem do `env` de next.config.js, então é inlinado em tempo de build — tanto no
 * bundle do cliente quanto no do servidor. É isso que faz a comparação funcionar: o
 * navegador de quem está com o app aberto há dias carrega o valor da build ANTIGA,
 * enquanto `/api/version` é servida pelo deploy NOVO e devolve o valor dele.
 *
 * `'dev'` fora da Vercel (ou se as System Environment Variables não estiverem
 * expostas no projeto).
 */
export const APP_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || 'dev'

/**
 * Época da sessão. **Bumpe este número à mão** na release em que você quiser que
 * TODOS os usuários precisem entrar de novo (ex.: mudou regra de permissão, ou algo
 * na sessão deixou de ser confiável).
 *
 * Deploy de rotina NÃO deve mexer aqui: subir este número derruba a base inteira
 * para o /login, inclusive o aluno no meio de um agendamento.
 *
 * Histórico:
 *   1 — valor inicial (não desloga ninguém; ver `precisaReautenticar`).
 */
export const SESSION_EPOCH = 1

/** Cookie que guarda a época que aquele navegador já viu. */
export const SESSION_EPOCH_COOKIE = 'arenahub_session_epoch'

/**
 * O cliente está rodando uma build diferente da que está no ar?
 *
 * Devolve false quando qualquer um dos lados é `'dev'`: em desenvolvimento os dois
 * valem `'dev'` e comparar seria inofensivo, mas se só um lado tiver a env definida
 * (build local apontando para outro ambiente, preview aberto por engano) a página
 * entraria em laço de reload. Falhar fechado aqui custa nada — no máximo o usuário
 * recarrega na mão.
 */
export function precisaRecarregar(buildDoCliente: string, buildDoServidor: unknown): boolean {
  if (typeof buildDoServidor !== 'string' || !buildDoServidor) return false
  if (buildDoCliente === 'dev' || buildDoServidor === 'dev') return false
  return buildDoCliente !== buildDoServidor
}

/**
 * Aquele navegador precisa autenticar de novo?
 *
 * Cookie ausente é tratado como "está em dia", NÃO como "precisa reautenticar". Sem
 * isso, o próprio deploy que introduz este mecanismo expulsaria todo mundo — ninguém
 * tem o cookie ainda. Quem chega sem cookie apenas recebe a época atual, e só é
 * afetado a partir do próximo bump.
 *
 * Valor corrompido (alguém mexeu no cookie, ou formato antigo) também não desloga:
 * é tratado como ausente e regravado.
 */
export function precisaReautenticar(epochDoCookie: string | undefined, epochAtual: number): boolean {
  if (!epochDoCookie) return false
  const visto = Number.parseInt(epochDoCookie, 10)
  if (!Number.isFinite(visto)) return false
  return visto < epochAtual
}
