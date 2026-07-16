// lib/checkin/partnerId.ts
// Normalização do ID do aluno no parceiro (Wellhub/TotalPass).
//
// Por que existe: o portal da Wellhub exibe o gympass_id agrupado com espaços
// (ex.: "3603 3181 0803 2"). Ao copiar/colar, o admin (ou o aluno, no
// autoatendimento) grava o ID COM os espaços — mas o webhook envia o
// unique_token limpo ("3603318108032"). O .eq() do match então nunca casa e
// todo check-in do aluno cai na fila de pendentes.
//
// .trim() NÃO resolve: remove só as pontas, não os espaços internos. Aqui cai
// TODO espaço em branco (\s já cobre NBSP), mais os zero-width que vêm junto
// em copy/paste de página web e que \s não pega.
const WHITESPACE = /[\s\u200b-\u200d\ufeff]/g

/**
 * Remove todo espaço em branco do ID do parceiro. Retorna null para vazio,
 * para gravar NULL na coluna em vez de string vazia.
 */
export function normalizePartnerId(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const normalized = raw.replace(WHITESPACE, '')
  return normalized || null
}
