// lib/plataforma/capacity.ts
// Leitura dos retratos de capacidade: onde a operação está hoje e quando cada
// teto de plano é cruzado no ritmo atual.
//
// Puro de propósito — nada aqui toca no banco, então a regra que decide "está na
// hora de subir de plano" é testável sem infra.
//
// O que NÃO dá para medir daqui: CPU e RAM da instância do Supabase, e
// invocações/GB-hrs da Vercel. Esses vivem no painel de cada serviço e estão
// listados em LIMITES_EXTERNOS para o painel mostrar junto — medir metade e
// calar sobre a outra metade daria falsa sensação de cobertura.

export interface TabelaMetrica {
  rows: number
  bytes: number
}

export interface CapacityMetrics {
  orgs: number
  orgs_ativas: number
  alunos: number
  alunos_ativos: number
  mau: number
  db_bytes: number
  tabelas: Record<string, TabelaMetrica>
}

export interface CapacitySnapshot {
  capturedAt: string
  metrics: CapacityMetrics
}

export const GB = 1024 ** 3
export const MB = 1024 ** 2

export type Severidade = 'ok' | 'atencao' | 'estourado'

export interface Limite {
  id: string
  titulo: string
  /** O que acontece quando cruza. */
  consequencia: string
  /** Valor de hoje. */
  atual: number
  /** Teto do plano atual. */
  teto: number
  unidade: 'bytes' | 'contagem'
  severidade: Severidade
  /** Fração do teto já usada (pode passar de 1). */
  uso: number
}

/** Acima disto o limite entra em "atenção" — margem para agir sem correria. */
const ATENCAO = 0.7

export interface LimiteSpec {
  id: string
  titulo: string
  consequencia: string
  teto: number
  unidade: 'bytes' | 'contagem'
  valor: (m: CapacityMetrics) => number
}

/**
 * Tetos medíveis pelo próprio banco.
 *
 * Os números vêm dos planos do Supabase e envelhecem — confira em
 * supabase.com/pricing antes de decidir com base neles. O que não envelhece é a
 * forma: valor de hoje contra teto, e a projeção de quando cruza.
 */
export const LIMITES: LimiteSpec[] = [
  {
    id: 'db_free',
    titulo: 'Banco de dados (plano Free)',
    consequencia: 'passar daqui exige o plano Pro do Supabase',
    teto: 500 * MB,
    unidade: 'bytes',
    valor: (m) => m.db_bytes,
  },
  {
    id: 'mau_free',
    titulo: 'Usuários ativos no mês (plano Free)',
    consequencia: 'passar daqui exige o plano Pro do Supabase',
    teto: 50_000,
    unidade: 'contagem',
    valor: (m) => m.mau,
  },
  {
    id: 'disco_pro',
    titulo: 'Disco incluso no plano Pro',
    consequencia: 'o excedente passa a ser cobrado por GB/mês',
    teto: 8 * GB,
    unidade: 'bytes',
    valor: (m) => m.db_bytes,
  },
  {
    id: 'mau_pro',
    titulo: 'Usuários ativos inclusos no plano Pro',
    consequencia: 'o excedente passa a ser cobrado por usuário',
    teto: 100_000,
    unidade: 'contagem',
    valor: (m) => m.mau,
  },
  {
    id: 'maior_tabela',
    titulo: 'Maior tabela do banco',
    consequencia: 'nesta ordem de grandeza, arquivar histórico e particionar deixam de ser opcionais',
    teto: 50_000_000,
    unidade: 'contagem',
    valor: (m) => maiorTabela(m)?.rows ?? 0,
  },
]

/** Tetos que só o painel do serviço enxerga — listados para não parecerem cobertos. */
export const LIMITES_EXTERNOS = [
  {
    servico: 'Supabase',
    metrica: 'CPU e RAM da instância',
    onde: 'Supabase → Reports → Database',
    gatilho: 'CPU sustentada acima de 70%, ou cache hit ratio abaixo de 99%',
  },
  {
    servico: 'Supabase',
    metrica: 'Queries mais caras',
    onde: 'Supabase → Advisors → Query Performance (pg_stat_statements)',
    gatilho: 'uma query dominando total_exec_time — quase sempre é índice faltando, não instância pequena',
  },
  {
    servico: 'Vercel',
    metrica: 'Invocações e GB-hrs de função',
    onde: 'Vercel → Observability → Usage',
    gatilho: 'custo por render subindo mais rápido que o número de alunos',
  },
  {
    servico: 'Vercel',
    metrica: 'Duração dos crons',
    onde: 'Vercel → Logs, filtrando /api/cron',
    gatilho: 'resposta com truncated: true, ou duração perto do maxDuration',
  },
] as const

export function maiorTabela(m: CapacityMetrics): (TabelaMetrica & { nome: string }) | null {
  const entradas = Object.entries(m.tabelas ?? {})
  if (entradas.length === 0) return null
  return entradas
    .map(([nome, v]) => ({ nome, ...v }))
    .sort((a, b) => b.rows - a.rows)[0]
}

export function avaliarLimites(m: CapacityMetrics): Limite[] {
  return LIMITES.map((spec) => {
    const atual = spec.valor(m)
    const uso = spec.teto > 0 ? atual / spec.teto : 0
    return {
      id: spec.id,
      titulo: spec.titulo,
      consequencia: spec.consequencia,
      atual,
      teto: spec.teto,
      unidade: spec.unidade,
      uso,
      severidade: uso >= 1 ? 'estourado' : uso >= ATENCAO ? 'atencao' : 'ok',
    }
  })
}

export interface Projecao {
  /** Crescimento por dia, na unidade da métrica. Negativo = encolhendo. */
  porDia: number
  /** Dias até cruzar o teto; null quando não dá para projetar. */
  diasAteTeto: number | null
  /** Data estimada do cruzamento (ISO, só o dia); null quando não dá para projetar. */
  dataEstimada: string | null
}

/**
 * Ritmo de crescimento por mínimos quadrados sobre os retratos, e a data em que a
 * curva cruza o teto.
 *
 * Regressão, e não "último menos primeiro dividido pelos dias": um dia atípico —
 * importação de alunos, limpeza de base — inclinaria demais a reta de dois pontos
 * e a data sairia semanas fora.
 *
 * Devolve diasAteTeto null quando não há como afirmar nada: menos de dois
 * retratos, todos no mesmo instante, ou crescimento parado/negativo (aí o teto
 * simplesmente não é cruzado no ritmo atual).
 */
export function projetar(
  pontos: Array<{ capturedAt: string; valor: number }>,
  teto: number,
  agora: Date = new Date(),
): Projecao {
  const vazio: Projecao = { porDia: 0, diasAteTeto: null, dataEstimada: null }
  if (pontos.length < 2) return vazio

  const DIA_MS = 86_400_000
  const t = pontos.map((p) => new Date(p.capturedAt).getTime() / DIA_MS)
  const y = pontos.map((p) => p.valor)
  if (t.some((v) => Number.isNaN(v))) return vazio

  const n = pontos.length
  const mediaT = t.reduce((a, b) => a + b, 0) / n
  const mediaY = y.reduce((a, b) => a + b, 0) / n

  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (t[i] - mediaT) * (y[i] - mediaY)
    den += (t[i] - mediaT) ** 2
  }
  // Todos os retratos no mesmo instante: sem eixo x, sem inclinação.
  if (den === 0) return vazio

  const porDia = num / den
  if (porDia <= 0) return { porDia, diasAteTeto: null, dataEstimada: null }

  // Extrapola a partir do valor mais recente, não do intercepto: o que importa é
  // a distância entre onde estamos HOJE e o teto.
  const atual = y[y.length - 1]
  if (atual >= teto) return { porDia, diasAteTeto: 0, dataEstimada: agora.toISOString().slice(0, 10) }

  const dias = (teto - atual) / porDia
  const data = new Date(agora.getTime() + dias * DIA_MS)
  return { porDia, diasAteTeto: dias, dataEstimada: data.toISOString().slice(0, 10) }
}

export function formatarBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export function formatarNumero(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(Math.round(n))
}
