// lib/plataforma/diagnostico.ts
// Achados da auditoria de escala, como dado.
//
// Isto é um retrato DATADO, não uma verificação viva: nada aqui é medido em
// tempo de execução. Está no painel porque a conclusão de uma auditoria costuma
// morrer numa conversa, e seis meses depois ninguém lembra por que
// `fetchAllPages` existe nem o que ainda ficou pendente.
//
// Ao mexer em qualquer um destes pontos, atualize o item — um diagnóstico que
// envelhece calado é pior que diagnóstico nenhum, porque passa a mentir com
// autoridade. AUDITORIA_EM marca o dia do levantamento para o leitor calibrar
// quanta fé depositar.

export const AUDITORIA_EM = '2026-08-09'

export type StatusAchado = 'corrigido' | 'pendente' | 'monitorar'

export interface Achado {
  id: string
  titulo: string
  /** O que acontecia, em uma frase. */
  sintoma: string
  /** Por que isso importa em escala. */
  impacto: string
  status: StatusAchado
  /** O que foi feito, ou o que falta fazer. */
  desfecho: string
}

export const ACHADOS: Achado[] = [
  {
    id: 'teto-postgrest',
    titulo: 'Teto de 1.000 linhas do PostgREST',
    sintoma:
      'toda resposta era cortada em 1.000 linhas com error: null junto — a query "dava certo" com resultado errado, sem acender Sentry. Havia 1 uso de .range() em 842 chamadas .from().',
    impacto:
      'não era risco futuro: já produzia sequência da Liga errada numa arena de 300 alunos, e a partir de ~250 arenas deixava as demais sem grade semanal.',
    status: 'corrigido',
    desfecho: 'fetchAllPages e chunk (lib/supabase/paginate.ts) nas leituras que crescem com a academia.',
  },
  {
    id: 'crons-sequenciais',
    titulo: 'Crons varrendo a base em série',
    sintoma:
      'credit-expiry fazia um select e um RPC por aluno, sequencialmente — ~100 mil round-trips com 300 mil alunos.',
    impacto: 'a invocação não terminava; o teto de 1.000 linhas escondia isso varrendo só uma fatia da base.',
    status: 'corrigido',
    desfecho:
      'leitura em lote por academia, escrita só para quem tem crédito vencido, paralelismo limitado e orçamento de tempo com truncated: true na resposta.',
  },
  {
    id: 'cascata-auth',
    titulo: 'Cascata de autenticação por request',
    sintoma:
      'os helpers de identidade se chamavam em cascata e cada elo refazia auth.getUser() mais um select em memberships: ~10 idas ao Auth por load da home, em série.',
    impacto: 'triplicava a latência da página e a conta da Vercel sem entregar nada.',
    status: 'corrigido',
    desfecho: 'requestCache nos helpers de lib/supabase/server.ts — a cascata colapsa em 1 getUser + 1 select.',
  },
  {
    id: 'rls-por-linha',
    titulo: 'RLS reavaliada linha a linha',
    sintoma:
      'nenhuma policy usava (select auth.uid()), e is_org_admin(organization_id) recebe coluna — as duas rodam por linha, e a segunda faz um select em memberships a cada linha.',
    impacto: 'medido em 300 mil linhas: 1.320ms contra 44ms depois da reescrita.',
    status: 'corrigido',
    desfecho:
      'migração 20260809000000 reescreveu as policies para InitPlan. Policy nova precisa nascer nessa forma — ver CLAUDE.md.',
  },
  {
    id: 'indices-uma-coluna',
    titulo: 'Índices de uma coluna nos caminhos quentes',
    sintoma:
      'os índices por organization_id foram criados em lote, um por tabela; as telas filtram por org + data, org + status, sessão + status.',
    impacto: 'com mil arenas, filtrar só por organization_id devolve milhões de linhas e o resto vira filtro em memória.',
    status: 'corrigido',
    desfecho: '11 índices compostos na migração 20260809000000.',
  },
  {
    id: 'vercel-hobby',
    titulo: 'Plano Hobby da Vercel',
    sintoma:
      'o Hobby limita cron a 1x/dia e corta função em 60s — os crons declaram maxDuration = 300, que não é honrado.',
    impacto:
      'os crons com orçamento de tempo só entregam o prometido no Pro. O Hobby também não permite uso comercial.',
    status: 'pendente',
    desfecho: 'upgrade para Pro. Depois dele, avaliar voltar weekly-grid-generation para de hora em hora.',
  },
  {
    id: 'benchmark-carga',
    titulo: 'Benchmark de carga sintética',
    sintoma: 'não existe medição de p95 sob carga — só estimativa a partir da forma do código.',
    impacto:
      'é o que responde "mil arenas aguentam?" com número em vez de projeção. Antes das correções acima ele mediria os defeitos, não a capacidade.',
    status: 'pendente',
    desfecho:
      'semear N arenas × 300 alunos com histórico, medir as 5 rotas quentes com N = 10, 50, 200 e extrapolar.',
  },
  {
    id: 'compute-supabase',
    titulo: 'Tamanho da instância do Supabase',
    sintoma: 'CPU e RAM não são visíveis daqui; a instância inclusa no Pro é pequena.',
    impacto: 'é o gargalo real bem antes do disco ou da contagem de linhas.',
    status: 'monitorar',
    desfecho:
      'Supabase → Reports. Gatilho: CPU sustentada acima de 70% ou cache hit ratio abaixo de 99%. Antes de subir a instância, olhar Query Performance — quase sempre é índice faltando.',
  },
]

export function contarPorStatus(achados: Achado[] = ACHADOS): Record<StatusAchado, number> {
  return achados.reduce(
    (acc, a) => ({ ...acc, [a.status]: acc[a.status] + 1 }),
    { corrigido: 0, pendente: 0, monitorar: 0 } as Record<StatusAchado, number>,
  )
}
