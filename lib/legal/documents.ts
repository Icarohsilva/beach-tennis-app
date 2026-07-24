// lib/legal/documents.ts
// Mapa de documentos legais e sua versão vigente. Fonte da verdade do CONTEÚDO é o
// markdown em docs/legal/*.md (git = histórico de revisão); a VERSÃO aqui é o que
// liga um aceite (legal_acceptances) a um texto específico — bump manual sempre que
// o conteúdo mudar de forma relevante o suficiente para exigir reaceite.

export const LEGAL_DOCUMENTS = {
  'termos-de-uso': {
    file: 'termos-de-uso.md',
    title: 'Termos de Uso',
    version: 1,
    effectiveDate: '2026-07-24',
  },
  'politica-privacidade': {
    file: 'politica-privacidade.md',
    title: 'Política de Privacidade',
    version: 1,
    effectiveDate: '2026-07-24',
  },
  'contrato-assinatura-saas': {
    file: 'contrato-assinatura-saas.md',
    title: 'Contrato de Assinatura SaaS',
    version: 1,
    effectiveDate: '2026-07-24',
  },
  'dpa-tratamento-dados': {
    file: 'dpa-tratamento-dados.md',
    title: 'Acordo de Tratamento de Dados (DPA)',
    version: 1,
    effectiveDate: '2026-07-24',
  },
  'politica-cookies': {
    file: 'politica-cookies.md',
    title: 'Política de Cookies',
    version: 1,
    effectiveDate: '2026-07-24',
  },
} as const

export type LegalSlug = keyof typeof LEGAL_DOCUMENTS

/** Aceite obrigatório no cadastro de aluno (e no 1º login de contas criadas por staff). */
export const STUDENT_REQUIRED_SLUGS: LegalSlug[] = ['termos-de-uso', 'politica-privacidade']

/** Aceite obrigatório na criação de academia — inclui o vínculo contratual do dono. */
export const OWNER_REQUIRED_SLUGS: LegalSlug[] = [
  'termos-de-uso',
  'politica-privacidade',
  'contrato-assinatura-saas',
  'dpa-tratamento-dados',
]
