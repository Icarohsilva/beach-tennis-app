// features/plataforma/capacityQuery.ts
// Coleta e leitura dos retratos de capacidade. A regra de decisão mora em
// lib/plataforma/capacity.ts (pura); aqui só entra o acesso ao banco.
import { createAdminClient } from '@/lib/supabase/server'
import type { CapacityMetrics, CapacitySnapshot } from '@/lib/plataforma/capacity'

type AdminClient = ReturnType<typeof createAdminClient>

/** Quantos dias de histórico alimentam a projeção. */
export const JANELA_PROJECAO_DIAS = 60

/**
 * Tira o retrato e grava. Devolve as métricas do momento.
 *
 * Chamado pelo cron diário. Guardar o retrato é o ponto: uma medição só diz onde
 * estamos, a série diz para onde vamos.
 */
export async function takeCapacitySnapshot(admin: AdminClient): Promise<CapacityMetrics> {
  const { data, error } = await admin.rpc('capacity_metrics')
  if (error) throw new Error(`capacity_metrics: ${error.message}`)

  const metrics = data as CapacityMetrics

  const { error: insertErr } = await admin.from('capacity_snapshots').insert({ metrics })
  if (insertErr) throw new Error(`capacity_snapshots insert: ${insertErr.message}`)

  return metrics
}

/** Retratos mais recentes, do mais antigo para o mais novo (ordem que a projeção espera). */
export async function getCapacityHistory(
  admin: AdminClient,
  dias: number = JANELA_PROJECAO_DIAS,
): Promise<CapacitySnapshot[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()

  const { data, error } = await admin
    .from('capacity_snapshots')
    .select('captured_at, metrics')
    .gte('captured_at', desde)
    .order('captured_at', { ascending: true })
    // Um por dia: a janela inteira cabe com folga abaixo do teto do PostgREST.
    .limit(500)

  if (error) throw new Error(`capacity_snapshots select: ${error.message}`)

  return ((data ?? []) as { captured_at: string; metrics: CapacityMetrics }[]).map((r) => ({
    capturedAt: r.captured_at,
    metrics: r.metrics,
  }))
}
