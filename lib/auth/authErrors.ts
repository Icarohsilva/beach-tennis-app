// lib/auth/authErrors.ts
// Mensagens do Supabase Auth em pt-BR. O supabase-js devolve `message` em inglês
// ("New password should be different from the old password."), e o app é todo em
// português — então traduzimos pelo `code`, que é estável, e nunca pelo texto, que
// muda entre versões. Código desconhecido cai no genérico em português: melhor uma
// frase vaga em pt do que uma frase precisa em inglês na cara do aluno.
const MENSAGENS: Record<string, string> = {
  same_password: 'A nova senha precisa ser diferente da senha atual.',
  weak_password: 'Senha muito fraca. Use pelo menos 6 caracteres.',
  session_expired: 'Sua sessão expirou. Faça login novamente para trocar a senha.',
  session_not_found: 'Sua sessão expirou. Faça login novamente para trocar a senha.',
  over_request_rate_limit: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
}

const GENERICA = 'Não foi possível alterar a senha. Tente novamente.'

export function mensagemErroSenha(code?: string): string {
  return (code && MENSAGENS[code]) || GENERICA
}
