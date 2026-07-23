// lib/org/permissions.ts
// Áreas do painel admin e regra de acesso por papel de staff.
// Dono (owner) acessa tudo; professor NÃO acessa financeiro/configurações/equipe.
export type AdminArea =
  | 'dashboard' | 'aulas' | 'alunos' | 'notificacoes' | 'torneios'
  | 'financeiro' | 'configuracoes' | 'equipe' | 'integracoes' | 'relatorios'

const OWNER_ONLY: AdminArea[] = ['financeiro', 'configuracoes', 'equipe']

export function canAccessArea(area: AdminArea, isOwner: boolean): boolean {
  return isOwner || !OWNER_ONLY.includes(area)
}
