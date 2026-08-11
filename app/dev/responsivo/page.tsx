// app/dev/responsivo/page.tsx
// Bancada de responsividade: renderiza os componentes que mais quebram em tela
// estreita com props FIXAS, sem tocar no Supabase.
//
// Existe porque o app inteiro depende de sessão + banco, então um teste que navegue
// nas rotas reais só roda com credencial. A bancada roda em qualquer lugar (CI,
// container limpo, máquina nova) e é o que `tests/responsive.spec.ts` mede: para
// cada bloco, em 320/375/414px, `scrollWidth <= clientWidth`.
//
// As fixtures são deliberadamente os PIORES casos, não casos médios: nome
// brasileiro comprido, moeda de 5 dígitos, rótulo de parceiro junto do "check-ins
// do mês", turma lotada. Fixture confortável não travaria regressão nenhuma.
//
// Barrada em produção: é ferramenta de desenvolvimento, não tela do produto.
import { notFound } from 'next/navigation'
import { HeroHeader } from '@/features/home/HeroHeader'
import { ClassCard } from '@/features/aulas/ClassCard'
import { CheckinProgressCard } from '@/components/ui/CheckinProgressCard'
import { StudentFrequencyCard } from '@/features/relatorios/StudentFrequencyCard'
import { LigaHero } from '@/features/liga/LigaHero'
import { StandingsTable } from '@/features/torneios/StandingsTable'
import { EventStat } from '@/features/torneios/EventStat'
import { StatCard } from '@/components/ui/StatCard'
import { DivisionRanking } from '@/features/liga/DivisionRanking'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import type { Class, StandingRow } from '@/types'

export const dynamic = 'force-static'

// Nome longo de verdade: é ele que expõe a tabela auto-layout que ignorava o
// `truncate` e crescia além do card.
const NOME_LONGO = 'Maria Fernanda Albuquerque Cavalcanti'

const TURMA: Class = {
  id: 'c1',
  organization_id: 'org1',
  name: 'Beach Tennis Intermediário — Quadra Coberta',
  description: 'Turma com foco em fundamentos e jogo de fundo de quadra.',
  level: 'B',
  sport: 'beach_tennis',
  type: 'adult',
  day_of_week: 1,
  start_time: '07:00',
  end_time: '08:00',
  max_students: 8,
  is_active: true,
  court: 1,
}

const STANDINGS: StandingRow[] = [
  { playerId: 'p1', played: 12, wins: 9, gamesFor: 108, gamesAgainst: 72, diff: 36, points: 27 },
  { playerId: 'p2', played: 12, wins: 7, gamesFor: 96, gamesAgainst: 84, diff: 12, points: 21 },
  { playerId: 'p3', played: 12, wins: 4, gamesFor: 78, gamesAgainst: 102, diff: -24, points: 12 },
]

const NOMES: Record<string, string> = {
  p1: NOME_LONGO,
  p2: 'João Pedro Gonçalves de Oliveira',
  p3: 'Ana',
}

/** Um bloco medido. O `data-rig` é o que o Playwright itera. */
function Bloco({ nome, children }: { nome: string; children: React.ReactNode }) {
  return (
    <section data-rig={nome} className="border-b border-surface-border p-4">
      {/* data-rig-label: o rótulo da bancada não é conteúdo do produto, e sem essa
          marca ele entrava nas asserções junto com os rótulos reais. */}
      <p
        data-rig-label
        className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"
      >
        {nome}
      </p>
      {children}
    </section>
  )
}

export default function BancadaResponsiva() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <div className="min-h-screen bg-surface text-white">
      <div className="mx-auto max-w-2xl">
        <Bloco nome="hero-header">
          <HeroHeader
            name="Icaro"
            stats={[
              { label: 'Créditos', value: 12 },
              { label: 'Aulas/semana', value: 3 },
              {
                label: 'Check-ins do mês · Wellhub',
                value: '5/12',
                progress: 5 / 12,
                hint: 'Faltam 7 para a meta',
              },
            ]}
          />
        </Bloco>

        <Bloco nome="class-card">
          <ClassCard class_={TURMA} enrolledCount={8} />
        </Bloco>

        <Bloco nome="checkin-progress">
          <CheckinProgressCard
            partner="totalpass"
            progress={{ target: 16, done: 12, remaining: 4, ahead: 0 }}
          />
        </Bloco>

        <Bloco nome="frequencia">
          <StudentFrequencyCard
            totals={{ studentId: 's1', present: 18, absent: 3, notified: 2, expected: 23, rate: 78 }}
            periodLabel="agosto de 2026"
          />
        </Bloco>

        <Bloco nome="liga-hero">
          <LigaHero
            division="diamante"
            points={1284}
            position={1}
            divisionSize={12}
            pointsToPromote={null}
            streakWeeks={7}
            sport="beach_tennis"
            endsOn="2026-08-31"
            promoteCount={3}
          />
        </Bloco>

        <Bloco nome="standings-table">
          <StandingsTable rows={STANDINGS} nameById={NOMES} highlightId="p1" />
        </Bloco>

        <Bloco nome="division-ranking">
          <DivisionRanking
            division="ouro"
            divisionSize={3}
            entries={[
              { studentId: 'p1', fullName: NOME_LONGO, avatarUrl: null, points: 240, position: 1, isMe: false },
              { studentId: 'p2', fullName: 'João Pedro Gonçalves', avatarUrl: null, points: 210, position: 2, isMe: true },
              { studentId: 'p3', fullName: 'Ana Beatriz Nascimento', avatarUrl: null, points: 180, position: 3, isMe: false },
            ]}
            promoteCount={1}
            demoteFrom={3}
          />
        </Bloco>

        <Bloco nome="event-stats">
          <dl className="grid grid-cols-3 gap-2">
            <EventStat label="Torneios" value={4} />
            <EventStat label="Com inscrição" value={2} tone="emerald" />
            <EventStat label="Atletas" value={128} tone="brand" />
          </dl>
        </Bloco>

        {/* Mesma grade da tela Wellhub (a única com StatCard em moeda): a bancada
            precisa medir o layout REAL, senão o teste passa sobre um caso mais fácil
            do que o que existe em produção. */}
        <Bloco nome="stat-cards-moeda">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Perdido no mês" value="R$ 12.345,67" hint="no mês, incluindo perdoadas" />
            <StatCard label="Receita parceiro" value="R$ 1.234,56" hint="sem valor configurado" />
          </div>
        </Bloco>

        {/* Padrão A na forma mais crua: rótulo longo contra chip que não pode
            encolher. Reproduz a linha do SubscriptionCard sem precisar de sessão. */}
        <Bloco nome="linha-rotulo-chip">
          <Card>
            <div className="flex flex-col gap-2 xs:flex-row xs:items-start xs:justify-between xs:gap-3">
              <div className="min-w-0">
                <h3 className="break-words font-semibold text-white">
                  Plano Mensal Ilimitado — Beach Tennis
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">Aulas livres em qualquer horário</p>
              </div>
              <span className="shrink-0">
                <Badge variant="warning">Aguardando pagamento</Badge>
              </span>
            </div>
          </Card>
        </Bloco>
      </div>
    </div>
  )
}
