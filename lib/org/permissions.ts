// lib/org/permissions.ts
// Áreas do painel admin e regra de acesso por papel de staff.
// Dono (owner) acessa tudo; professor NÃO acessa financeiro/configurações/equipe.
export type AdminArea =
  | 'dashboard' | 'aulas' | 'alunos' | 'notificacoes' | 'torneios'
  | 'financeiro' | 'configuracoes' | 'equipe' | 'integracoes' | 'relatorios'
  // Controle Wellhub NÃO é owner-only: quem faz a chamada é o professor, e é ele
  // quem cria as pendências. A configuração de valor/limite dentro da tela é que
  // fica escondida de quem não é dono.
  | 'wellhub'

const OWNER_ONLY: AdminArea[] = ['financeiro', 'configuracoes', 'equipe']

export function canAccessArea(area: AdminArea, isOwner: boolean): boolean {
  return isOwner || !OWNER_ONLY.includes(area)
}
