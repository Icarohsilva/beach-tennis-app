// app/(super-admin)/super-admin/capacidade/page.tsx
// Onde a operação está e quando cada teto de plano é cruzado.
//
// A pergunta que esta tela responde não é "está tudo bem?" — é "em que data
// preciso mexer no plano?". Por isso cada limite mostra a projeção junto do valor
// atual, e por isso os limites que só o painel do Supabase/Vercel enxerga
// aparecem listados: metade medida com a outra metade escondida daria a falsa
// impressão de cobertura completa.
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { getCapacityHistory, JANELA_PROJECAO_DIAS } from '@/features/plataforma/capacityQuery'
import {
  avaliarLimites,
  projetar,
  maiorTabela,
  formatarBytes,
  formatarNumero,
  LIMITES,
  LIMITES_EXTERNOS,
  type Limite,
  type CapacitySnapshot,
} from '@/lib/plataforma/capacity'
import {
  projetarEscala,
  avaliarMaturidade,
  ALVO_PADRAO,
  type AlvoEscala,
} from '@/lib/plataforma/projecaoEscala'
import { ACHADOS, AUDITORIA_EM, contarPorStatus, type StatusAchado } from '@/lib/plataforma/diagnostico'

const CORES: Record<Limite['severidade'], string> = {
  ok: 'text-emerald-400',
  atencao: 'text-amber-400',
  estourado: 'text-red-400',
}

const BARRAS: Record<Limite['severidade'], string> = {
  ok: 'bg-emerald-500',
  atencao: 'bg-amber-500',
  estourado: 'bg-red-500',
}

function valorFormatado(l: Pick<Limite, 'unidade'>, v: number) {
  return l.unidade === 'bytes' ? formatarBytes(v) : formatarNumero(v)
}

function textoProjecao(dias: number | null, data: string | null, historico: number) {
  if (historico < 2) return `sem série ainda — a projeção começa com 2 retratos (hoje: ${historico})`
  if (dias === null) return 'não cruza no ritmo atual'
  if (dias <= 0) return 'teto já cruzado'
  if (dias > 3650) return 'mais de 10 anos no ritmo atual'
  return `~${formatarNumero(dias)} dias (por volta de ${new Date(data!).toLocaleDateString('pt-BR')})`
}

const STATUS_ROTULO: Record<StatusAchado, string> = {
  corrigido: 'Corrigido',
  pendente: 'Pendente',
  monitorar: 'Monitorar',
}

const STATUS_CLASSE: Record<StatusAchado, string> = {
  corrigido: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  pendente: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  monitorar: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
}

/** Alvos oferecidos no seletor — o padrão é a pergunta que originou o painel. */
const PRESETS: AlvoEscala[] = [
  { arenas: 100, alunosPorArena: 300 },
  { arenas: 500, alunosPorArena: 300 },
  { arenas: 1000, alunosPorArena: 300 },
]

/** Lê o alvo da URL, caindo no padrão quando vier ausente ou sem sentido. */
function alvoDaUrl(sp: Record<string, string | string[] | undefined>): AlvoEscala {
  const num = (v: string | string[] | undefined, padrao: number) => {
    const n = Number(Array.isArray(v) ? v[0] : v)
    return Number.isFinite(n) && n > 0 && n <= 100_000 ? Math.round(n) : padrao
  }
  return {
    arenas: num(sp.arenas, ALVO_PADRAO.arenas),
    alunosPorArena: num(sp.alunos, ALVO_PADRAO.alunosPorArena),
  }
}

export default async function CapacidadePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const admin = createAdminClient()
  const alvo = alvoDaUrl(searchParams ?? {})

  let historico: CapacitySnapshot[] = []
  let erro: string | null = null
  try {
    historico = await getCapacityHistory(admin)
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e)
  }

  if (erro) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Capacidade</h1>
        <Card className="p-4">
          <p className="text-sm text-red-400">Não foi possível ler os retratos: {erro}</p>
          <p className="mt-2 text-sm text-slate-400">
            Se a migração <code>20260809000100_capacity_snapshots.sql</code> ainda não foi aplicada,
            rode <code>supabase db push</code>.
          </p>
        </Card>
      </div>
    )
  }

  const atual = historico[historico.length - 1] ?? null

  if (!atual) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Capacidade</h1>
        <Card className="p-4">
          <p className="text-sm text-slate-300">Nenhum retrato ainda.</p>
          <p className="mt-2 text-sm text-slate-400">
            O cron <code>/api/cron/capacity-snapshot</code> roda uma vez por dia e grava o primeiro.
            A projeção aparece a partir do segundo retrato.
          </p>
        </Card>
      </div>
    )
  }

  const m = atual.metrics
  const limites = avaliarLimites(m)
  const maior = maiorTabela(m)

  // Idade da operação: a extrapolação assume o histórico por aluno de hoje, e
  // numa base nova esse histórico é raso. Sem isso ao lado, o número projetado
  // seria lido como teto quando na verdade é piso.
  const { data: primeiraOrg } = await admin
    .from('organizations')
    .select('created_at')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const maturidade = avaliarMaturidade((primeiraOrg?.created_at as string | undefined) ?? null)
  const escala = projetarEscala(m, alvo)
  const statusAchados = contarPorStatus()

  const tabelas = Object.entries(m.tabelas ?? {})
    .map(([nome, v]) => ({ nome, ...v }))
    .sort((a, b) => b.bytes - a.bytes)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Capacidade</h1>
          <p className="text-sm text-slate-400">
            Retrato de {new Date(atual.capturedAt).toLocaleString('pt-BR')} ·{' '}
            {historico.length} retrato(s) nos últimos {JANELA_PROJECAO_DIAS} dias
          </p>
        </div>
        <Link
          href="/super-admin"
          className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-surface-border"
        >
          Voltar
        </Link>
      </div>

      {/* Tamanho da operação */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { rotulo: 'Academias', valor: formatarNumero(m.orgs), extra: `${formatarNumero(m.orgs_ativas)} ativas` },
          { rotulo: 'Alunos', valor: formatarNumero(m.alunos), extra: `${formatarNumero(m.alunos_ativos)} com contrato` },
          { rotulo: 'Ativos no mês', valor: formatarNumero(m.mau), extra: 'base do MAU cobrado' },
          { rotulo: 'Banco', valor: formatarBytes(m.db_bytes), extra: maior ? `maior: ${maior.nome}` : '—' },
        ].map((c) => (
          <Card key={c.rotulo} className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">{c.rotulo}</p>
            <p className="mt-1 text-2xl font-bold text-white">{c.valor}</p>
            <p className="mt-1 text-xs text-slate-400">{c.extra}</p>
          </Card>
        ))}
      </div>

      {/* Tetos medidos aqui */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Tetos medidos no banco
        </h2>
        {limites.map((l) => {
          const spec = LIMITES.find((s) => s.id === l.id)!
          const serie = historico.map((h) => ({ capturedAt: h.capturedAt, valor: spec.valor(h.metrics) }))
          const p = projetar(serie, l.teto)
          return (
            <Card key={l.id} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-white">{l.titulo}</span>
                <span className={`text-sm font-semibold ${CORES[l.severidade]}`}>
                  {valorFormatado(l, l.atual)} / {valorFormatado(l, l.teto)}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-border">
                <div
                  className={`h-full rounded-full ${BARRAS[l.severidade]}`}
                  style={{ width: `${Math.min(100, Math.max(1, l.uso * 100))}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Ao cruzar: {l.consequencia}.
              </p>
              <p className="mt-1 text-xs text-slate-300">
                Projeção: {textoProjecao(p.diasAteTeto, p.dataEstimada, historico.length)}
              </p>
            </Card>
          )
        })}
      </section>

      {/* Simulação de escala */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Se a operação chegar em {formatarNumero(alvo.arenas)} arenas ×{' '}
            {formatarNumero(alvo.alunosPorArena)} alunos
          </h2>
          <div className="flex gap-1">
            {PRESETS.map((p) => {
              const ativo = p.arenas === alvo.arenas && p.alunosPorArena === alvo.alunosPorArena
              return (
                <Link
                  key={p.arenas}
                  href={`/super-admin/capacidade?arenas=${p.arenas}&alunos=${p.alunosPorArena}`}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    ativo
                      ? 'border-brand-500 bg-brand-500/15 text-brand-500'
                      : 'border-surface-border text-slate-300 hover:bg-surface-border'
                  }`}
                >
                  {formatarNumero(p.arenas)}
                </Link>
              )
            })}
          </div>
        </div>

        <Card className="p-4">
          <p className="text-sm text-slate-300">
            Extrapolação a partir do que a base consome hoje: {formatarNumero(m.alunos)} aluno(s) em{' '}
            {formatarNumero(m.orgs)} arena(s) → {formatarNumero(escala.alunosAlvo)} alunos, ou{' '}
            <strong className="text-white">{escala.fator.toFixed(1)}×</strong> a base atual.
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Só a parte que cresce com aluno é multiplicada — {formatarBytes(escala.bytesFixos)} de
            catálogo e configuração entram como parcela fixa.
          </p>

          {!escala.confiavel && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              Número frágil: {escala.ressalva}.
            </p>
          )}
          <p className="mt-2 rounded-lg border border-surface-border bg-surface p-3 text-xs text-slate-300">
            {maturidade.dias > 0 && `Base com ${formatarNumero(maturidade.dias)} dias de operação — `}
            {maturidade.aviso}.
          </p>
        </Card>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {escala.limites.map((l) => (
            <Card key={l.id} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-white">{l.titulo}</span>
                <span className={`text-sm font-semibold ${CORES[l.severidade]}`}>
                  {valorFormatado(l, l.atual)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Teto: {valorFormatado(l, l.teto)} —{' '}
                {l.severidade === 'estourado'
                  ? `estoura em ${(l.uso).toFixed(1)}× o teto`
                  : l.severidade === 'atencao'
                    ? 'chega perto do teto'
                    : 'cabe com folga'}
                .
              </p>
            </Card>
          ))}
        </div>

        {escala.tabelas.length > 0 && (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-border text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="p-3">Tabela</th>
                  <th className="p-3 text-right">Linhas hoje</th>
                  <th className="p-3 text-right">Linhas no alvo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {escala.tabelas.slice(0, 8).map((t) => (
                  <tr key={t.nome}>
                    <td className="p-3 text-slate-200">{t.nome}</td>
                    <td className="p-3 text-right text-slate-400">{formatarNumero(t.atual)}</td>
                    <td className="p-3 text-right font-semibold text-slate-200">
                      {formatarNumero(t.projetado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {/* Diagnóstico de arquitetura */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Diagnóstico de arquitetura
          </h2>
          <span className="text-xs text-slate-400">
            auditoria de {new Date(AUDITORIA_EM).toLocaleDateString('pt-BR')} ·{' '}
            {statusAchados.corrigido} corrigido(s) · {statusAchados.pendente} pendente(s) ·{' '}
            {statusAchados.monitorar} a monitorar
          </span>
        </div>

        <p className="text-xs text-slate-400">
          Retrato datado, não verificação viva: nada aqui é medido em tempo de execução. Ao mexer em
          algum destes pontos, atualize <code>lib/plataforma/diagnostico.ts</code>.
        </p>

        <Card className="divide-y divide-surface-border p-0">
          {ACHADOS.map((a) => (
            <div key={a.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">{a.titulo}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASSE[a.status]}`}
                >
                  {STATUS_ROTULO[a.status]}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">{a.sintoma}</p>
              <p className="mt-1 text-xs text-slate-300">
                <span className="text-slate-500">Impacto:</span> {a.impacto}
              </p>
              <p className="mt-1 text-xs text-slate-300">
                <span className="text-slate-500">
                  {a.status === 'corrigido' ? 'Como ficou:' : 'O que falta:'}
                </span>{' '}
                {a.desfecho}
              </p>
            </div>
          ))}
        </Card>
      </section>

      {/* Tetos que este painel NÃO enxerga */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Tetos que só o painel do serviço enxerga
        </h2>
        <Card className="divide-y divide-surface-border p-0">
          {LIMITES_EXTERNOS.map((e) => (
            <div key={`${e.servico}-${e.metrica}`} className="p-4">
              <p className="text-sm font-semibold text-white">
                {e.servico} · {e.metrica}
              </p>
              <p className="mt-1 text-xs text-slate-400">Onde olhar: {e.onde}</p>
              <p className="mt-1 text-xs text-slate-300">Hora de agir: {e.gatilho}</p>
            </div>
          ))}
        </Card>
      </section>

      {/* Tabelas */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Tabelas que crescem
        </h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-surface-border text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="p-3">Tabela</th>
                <th className="p-3 text-right">Linhas (estimativa)</th>
                <th className="p-3 text-right">Tamanho</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {tabelas.map((t) => (
                <tr key={t.nome}>
                  <td className="p-3 text-slate-200">{t.nome}</td>
                  <td className="p-3 text-right text-slate-300">{formatarNumero(t.rows)}</td>
                  <td className="p-3 text-right text-slate-300">{formatarBytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  )
}
