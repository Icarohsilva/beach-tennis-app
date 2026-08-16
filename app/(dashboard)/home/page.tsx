// app/(dashboard)/home/page.tsx
// force-dynamic explícito: o puxar-para-atualizar do app (PullToRefresh) chama
// router.refresh() e precisa que este RSC seja sempre rebuscado, nunca servido
// de cache — senão o gesto anima mas devolve os mesmos dados.
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getActiveMembership, getActiveOrgId, getAuthUser, getMemberships } from '@/lib/supabase/server'
import { hasStudentAccess } from '@/lib/org/activeOrg'
import { formatDate } from '@/lib/utils/dateHelpers'
import { addDaysISO } from '@/lib/utils/agenda'
import { HeroHeader } from '@/features/home/HeroHeader'
import { SpotlightRow } from '@/features/home/SpotlightRow'
import { ArenaWeek } from '@/features/home/ArenaWeek'
import { ArenaCalendar } from '@/features/home/ArenaCalendar'
import { getArenaExtras, getArenaMonth } from '@/features/home/arenaMonthQuery'
import { monthOf } from '@/lib/home/arenaAgenda'
import type { AgendaSession } from '@/features/home/agendaTypes'
import { SelfCheckinCard, type SelfCheckinCandidate } from '@/features/home/SelfCheckinCard'
import { SelfCheckinModal } from '@/features/home/SelfCheckinModal'
import { buildAgendaSessions, type SessionRowWithClass } from '@/features/home/sessionDetailQuery'
import { Reveal } from '@/components/ui/Reveal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { computeProgress } from '@/lib/checkin/progress'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import { countDistinctCheckinDays } from '@/lib/checkin/monthlyProgress'
import {
  summarizeMissedCheckins,
  type MissedCheckinSummary,
} from '@/lib/checkin/missedCheckins'
import { getMissedCheckinSettings } from '@/features/checkin/missedCheckinSettings'
import { getStudentFrequency } from '@/features/relatorios/query'
import { StudentFrequencyCard } from '@/features/relatorios/StudentFrequencyCard'
import { CalendarDays } from 'lucide-react'
import { RecommendationBanner } from '@/features/financeiro/RecommendationBanner'
import { PERIODICITY_LABELS } from '@/lib/billing/periodicity'
import { getActivePlan } from '@/lib/billing/planEligibility'
import { getQuotaSnapshot } from '@/features/aulas/quotaUsage'
import { isQuotaEnforced } from '@/features/aulas/quotaSettings'
import { getClassRules } from '@/features/aulas/classRulesQuery'
import { RulesCard } from '@/features/home/RulesCard'
import { brtToday } from '@/lib/utils/gridSchedule'
import type { Profile, Periodicity, MissedCheckinStatus } from '@/types'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function HomePage() {
  const supabase = createClient()
  const user = await getAuthUser()
  if (!user) redirect('/login')

  // Quem ainda não é aluno de nenhuma academia não tem agenda, plano nem
  // presença: a Home inteira sairia vazia. O lugar dele é a descoberta.
  const memberships = await getMemberships()
  if (!hasStudentAccess(memberships)) redirect('/explorar')

  // brtToday, não toISOString: a Vercel roda em UTC, então das 21h à meia-noite
  // BRT o "hoje" cru já era amanhã — a agenda pulava o dia e o corte de
  // `attendanceReport` tratava as aulas de amanhã como passadas.
  const today = brtToday(new Date())
  const adminClient = createAdminClient()

  // Campos por-academia vêm da membership da academia ativa; identidade (full_name) de profiles.
  const orgId = await getActiveOrgId()
  const membership = await getActiveMembership()

  // Cota do plano — mesmo retrato exibido em /agendar. Só busca quando a
  // academia ligou a regra e o aluno tem plano ativo (evita 2 queries à toa).
  const plan = orgId ? await getActivePlan(adminClient, user.id, orgId) : null
  const quotaOn = orgId ? await isQuotaEnforced(adminClient, orgId) : false
  const quota =
    quotaOn && plan && orgId
      ? await getQuotaSnapshot(adminClient, user.id, orgId, plan, brtToday(new Date()))
      : null

  const { data: recRaw } = await adminClient
    .from('plan_recommendations')
    .select('id, plan_id, billing_option_id, subscription_plans(name), plan_billing_options(periodicity, price)')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .maybeSingle()

  const recPlan = recRaw
    ? ((Array.isArray(recRaw.subscription_plans) ? recRaw.subscription_plans[0] : recRaw.subscription_plans) as { name: string } | null)
    : null
  const recOption = recRaw
    ? ((Array.isArray(recRaw.plan_billing_options) ? recRaw.plan_billing_options[0] : recRaw.plan_billing_options) as { periodicity: Periodicity; price: number } | null)
    : null

  // CTA de assinatura: só para quem não é Wellhub/TotalPass puro (esses não
  // precisam assinar no app) e ainda não tem plano ativo/pendente. Aluno
  // híbrido (parceiro + assinatura própria) cai fora do CTA porque já tem sub.
  const { data: existingSub } = await adminClient
    .from('student_subscriptions')
    .select('id')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .in('status', ['active', 'past_due', 'pending_payment'])
    .maybeSingle()

  const [{ data: profileData }, { count: weeklyClassesCount }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single(),
    supabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', user.id)
      .eq('organization_id', orgId)
      .eq('is_active', true),
  ])

  const profile = profileData as Pick<Profile, 'full_name'> | null
  const showCredits = !membership?.partner
  const isPartner = !!membership?.partner
  // Não mostra o CTA genérico se já existe uma recomendação de plano do admin
  // (mais específica) ou se o aluno já tem plano/pendência em andamento.
  const showPlanCTA = !isPartner && !existingSub && !recRaw
  let checkinProgress: ReturnType<typeof computeProgress> | null = null
  let missedCheckins: MissedCheckinSummary | null = null
  if (isPartner && membership && orgId) {
    // Dias DISTINTOS, não linhas: duas aulas na terça contam 1 pra meta do mês
    // (spec 2026-07-29-checkin-diario-unico).
    const done = await countDistinctCheckinDays(
      adminClient,
      user.id,
      orgId,
      getMonthWindow(new Date()),
    )
    checkinProgress = computeProgress(membership.monthly_checkin_target, done)

    const [{ data: missedRaw }, { blockLimit }] = await Promise.all([
      adminClient
        .from('missed_checkins')
        .select('id, session_date, amount, status')
        .eq('student_id', user.id)
        .eq('organization_id', orgId)
        .eq('status', 'open'),
      getMissedCheckinSettings(adminClient, orgId),
    ])
    const summary = summarizeMissedCheckins(
      ((missedRaw ?? []) as {
        id: string
        session_date: string
        amount: number | string
        status: MissedCheckinStatus
      }[]).map((r) => ({
        id: r.id,
        sessionDate: r.session_date,
        amount: Number(r.amount),
        status: r.status,
      })),
      blockLimit,
    )
    if (summary.openCount > 0) missedCheckins = summary
  }
  const frequencyWindow = getMonthWindow(new Date())
  const frequency = orgId
    ? await getStudentFrequency(orgId, user.id, frequencyWindow, today)
    : null
  // ── Matrículas fixas do aluno (usadas na agenda) ──────────────────────────
  const { data: studentEnrollmentsRaw } = await supabase
    .from('enrollments')
    .select('class_id')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const enrolledClassIds = new Set(
    (studentEnrollmentsRaw ?? []).map((e: { class_id: string }) => e.class_id),
  )

  // ── Agenda dos próximos 7 dias ────────────────────────────────────────────
  const weekEnd = addDaysISO(today, 6)
  const { data: weekSessionsRaw } = await adminClient
    .from('class_sessions')
    .select(
      'id, session_date, class_id, status, cancelled_reason, start_time, end_time, court, max_students, classes(name, start_time, end_time, type, sport, max_students, court)',
    )
    .eq('organization_id', orgId)
    .gte('session_date', today)
    .lte('session_date', weekEnd)
    // Cancelada entra junto, marcada: some da agenda era o que fazia o aluno
    // descobrir na quadra quando o aviso não chegava.
    .in('status', ['scheduled', 'cancelled'])
    .order('session_date', { ascending: true })

  const weekSessionRows = (weekSessionsRaw ?? []) as unknown as SessionRowWithClass[]

  // ── Confirmação de presença pelo app ──────────────────────────────────────
  const { data: orgSelfCheckinRow } = orgId
    ? await adminClient
        .from('organizations')
        .select('self_checkin_enabled')
        .eq('id', orgId)
        .maybeSingle()
    : { data: null }

  const selfCheckinEnabled =
    (orgSelfCheckinRow as { self_checkin_enabled: boolean } | null)?.self_checkin_enabled ?? false

  // Regras do sistema para o modal do dashboard — derivadas da MESMA
  // configuração usada acima (lib/aulas/classRules.ts), nunca texto fixo.
  const ruleSections = orgId
    ? await getClassRules(adminClient, {
        orgId,
        plan,
        quotaEnforced: quotaOn,
        isPartner,
        selfCheckinEnabled,
      })
    : []

  // A ficha da aula (quem vai, fila, minha reserva, linhas dos dependentes) é
  // montada em features/home/sessionDetailQuery.ts, e não aqui, porque o
  // calendário do mês abre o MESMO modal por uma action — duas montagens
  // separadas divergiriam.
  const agendaSessions: AgendaSession[] = await buildAgendaSessions(adminClient, {
    orgId: orgId!,
    userId: user.id,
    partner: membership?.partner ?? null,
    selfCheckinEnabled,
    enrolledClassIds,
    rows: weekSessionRows,
    creditsBalance: membership?.credits_balance ?? 0,
    // Com a cota desligada o plano é ilimitado, então ele sempre é um caminho
    // possível; com ela ligada, só enquanto sobrar cota.
    hasPlanQuota: plan !== null && (!quotaOn || (quota?.remaining ?? 0) > 0),
  })

  // Destaque: as aulas do aluno vêm primeiro; sem nenhuma, oferece as que ainda
  // têm vaga. O card final é escolhido no cliente, pelo relógio do aluno.
  //
  // Vai a sessão INTEIRA, não um resumo: o card abre a mesma ficha da agenda, e
  // ela precisa de quem vai, fila de espera e a reserva do aluno para poder
  // oferecer entrar ou sair.
  const mySessions = agendaSessions.filter((s) => s.mine || s.fixed)
  // Aula cancelada nunca vai para o destaque: a home existe para dizer "é aqui
  // que você vai agora", e apontar para uma aula que não vai acontecer é o
  // oposto do objetivo. Ela continua visível na faixa da semana, marcada.
  const spotlightCandidates: AgendaSession[] = (
    mySessions.length > 0
      ? mySessions.filter((s) => !s.cancelled)
      : agendaSessions.filter((s) => !s.cancelled && s.booked < s.capacity)
  ).slice(0, 6)

  // ── Torneio e day use ─────────────────────────────────────────────────────
  // A agenda da arena não é só aula: a faixa da semana recebe a janela de 7
  // dias, e o calendário recebe o mês corrente (as setas dele trocam por action).
  const currentMonth = monthOf(today)
  const [weekExtras, monthEvents] = orgId
    ? await Promise.all([
        getArenaExtras({ orgId, userId: user.id, from: today, to: weekEnd }),
        getArenaMonth({ orgId, userId: user.id, monthISO: currentMonth }),
      ])
    : [[], []]

  // Candidatas ao atalho de confirmação na home. Qual (se alguma) tem a janela
  // aberta é decisão do cliente, pelo relógio do aluno.
  const selfCheckinCandidates: SelfCheckinCandidate[] = mySessions
    .filter((s) => s.selfCheckin)
    .map((s) => ({
      sessionId: s.id,
      className: s.className,
      start: s.start,
      end: s.end,
      view: s.selfCheckin!,
    }))

  return (
    <div className="space-y-5 p-4 pb-24">
      {recRaw && (
        <RecommendationBanner
          recommendationId={recRaw.id as string}
          planName={recPlan?.name ?? 'Plano'}
          periodicityLabel={PERIODICITY_LABELS[recOption?.periodicity ?? 'monthly']}
          price={recOption?.price ?? 0}
        />
      )}

      <Reveal step={0}>
        <div data-tour="tour-aluno-progresso">
          <HeroHeader
            name={profile?.full_name?.split(' ')[0] ?? 'atleta'}
            stats={[
              ...(showCredits
                ? [{ label: 'Créditos', value: membership?.credits_balance ?? 0 }]
                : [{ label: 'Plano', value: membership?.partner === 'wellhub' ? 'Wellhub' : 'TotalPass' }]),
              { label: 'Aulas/semana', value: weeklyClassesCount ?? 0 },
              // A terceira pastilha responde "quanto do meu mês já usei". Para
              // quem é Wellhub/TotalPass isso é a meta de check-ins (o que ele
              // precisa bater para não ser cobrado); para quem assina plano, a
              // cota de aulas. São a mesma pergunta com fonte diferente, então
              // ocupam o mesmo lugar em vez de um card extra só para o parceiro.
              ...(checkinProgress && checkinProgress.target > 0
                ? [{
                    label: `Check-ins do mês · ${membership?.partner === 'wellhub' ? 'Wellhub' : 'TotalPass'}`,
                    value: `${checkinProgress.done}/${checkinProgress.target}`,
                    progress: checkinProgress.done / checkinProgress.target,
                    hint:
                      checkinProgress.remaining > 0
                        ? `Faltam ${checkinProgress.remaining} para a meta`
                        : 'Meta do mês batida!',
                  }]
                : quota
                  ? [{
                      label: `Aulas do plano ${plan?.cycle === 'weekly' ? 'nesta semana' : 'neste mês'}`,
                      value: `${quota.used}/${quota.limit}`,
                      progress: quota.limit > 0 ? quota.used / quota.limit : undefined,
                    }]
                  : [{ label: 'Nesta semana', value: mySessions.length }]),
            ]}
          />
        </div>
      </Reveal>

      {/* Parceiro (Wellhub/TotalPass) é isento da cota mesmo com plano híbrido
          vinculado — mesma regra de resolveClassAccess. Mostra o "X de Y" pro
          aluno acompanhar, mas nunca o aviso de bloqueio, que não se aplica. */}
      {quota?.remaining === 0 && !isPartner && (
        <Reveal step={1}>
          <p className="text-xs text-brand-400 -mt-2">
            Cota esgotada. Cancele uma aula futura ou compre uma avulsa.
          </p>
        </Reveal>
      )}

      {/* Saldo acumulado: sem esta linha o total cresce sem explicação ("por que
          tenho 13 aulas se meu plano é de 8?") e vira dúvida no grupo. */}
      {!!quota?.carriedIn && !isPartner && (
        <Reveal step={1}>
          <p className="-mt-2 text-xs text-slate-400">
            Inclui {quota.carriedIn} {quota.carriedIn === 1 ? 'aula guardada' : 'aulas guardadas'}{' '}
            {plan?.cycle === 'weekly' ? 'da semana anterior' : 'do mês anterior'}.
          </p>
        </Reveal>
      )}

      <Reveal step={1}>
        <RulesCard sections={ruleSections} />
      </Reveal>

      {selfCheckinCandidates.length > 0 && (
        <Reveal step={1}>
          <SelfCheckinCard candidates={selfCheckinCandidates} />
          <SelfCheckinModal candidates={selfCheckinCandidates} />
        </Reveal>
      )}

      {/* Check-in que não aconteceu: a academia perdeu o repasse daquela aula.
          Bloqueado ganha o card em destaque; quem só acumulou, a linha discreta —
          mesma gradação do aviso de cota acima. */}
      {missedCheckins && (
        <Reveal step={2}>
          {missedCheckins.blocked ? (
            <Link href="/financeiro" className="group block">
              <div className="sheen relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-brand-600 to-brand-800 p-4 shadow-[0_18px_44px_-26px_rgb(var(--brand-600)/0.95)] transition-transform duration-200 group-hover:-translate-y-0.5">
                <div className="relative flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">Agendamento bloqueado</p>
                    <p className="mt-0.5 text-xs text-white/80">
                      {missedCheckins.openCount} check-in
                      {missedCheckins.openCount !== 1 ? 's' : ''} do parceiro em aberto
                      {missedCheckins.openAmount > 0
                        ? ` · ${BRL.format(missedCheckins.openAmount)}`
                        : ''}
                      . Resolva para voltar a agendar.
                    </p>
                  </div>
                  <span className="text-lg text-white transition-transform duration-200 group-hover:translate-x-0.5">
                    →
                  </span>
                </div>
              </div>
            </Link>
          ) : (
            <Link href="/financeiro" className="block text-xs text-brand-400 hover:text-brand-300">
              {missedCheckins.openCount} check-in
              {missedCheckins.openCount !== 1 ? 's' : ''} do parceiro em aberto
              {missedCheckins.openAmount > 0
                ? ` (${BRL.format(missedCheckins.openAmount)})`
                : ''}
              {missedCheckins.untilBlock !== null && missedCheckins.untilBlock > 0
                ? `. Mais ${missedCheckins.untilBlock} e seu agendamento é bloqueado.`
                : '.'}{' '}
              Resolver →
            </Link>
          )}
        </Reveal>
      )}

      {/* Próxima aula e frequência dividem a linha: são os dois retratos do
          "como estou" e nenhum dos dois precisa da largura inteira. Sem aula à
          frente, o SpotlightRow devolve só a frequência, ocupando tudo. */}
      <Reveal step={1}>
        <SpotlightRow candidates={spotlightCandidates} todayISO={today}>
          <StudentFrequencyCard totals={frequency} periodLabel={formatDate(today, 'MMMM')} />
        </SpotlightRow>
      </Reveal>

      {showPlanCTA && (
        <Reveal step={2}>
          <Link href="/financeiro" className="group block">
            <div className="sheen relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-brand-600 to-brand-800 p-4 shadow-[0_18px_44px_-26px_rgb(var(--brand-600)/0.95)] transition-transform duration-200 group-hover:-translate-y-0.5">
              <div className="relative flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">Assine um plano</p>
                  <p className="mt-0.5 text-xs text-white/80">
                    Aulas incluídas todo mês, sem pagar aula avulsa.
                  </p>
                </div>
                <span className="shrink-0 text-xl text-white transition-transform group-hover:translate-x-1">
                  →
                </span>
              </div>
            </div>
          </Link>
        </Reveal>
      )}

      {/* Agenda da semana — aula abre a ficha em modal (ver/entrar/sair);
          torneio e day use levam para a página deles. */}
      {(agendaSessions.length > 0 || weekExtras.length > 0) && (
        <Reveal step={3} as="section">
          <SectionHeader title="Agenda da academia" />
          <ArenaWeek todayISO={today} sessions={agendaSessions} events={weekExtras} />
        </Reveal>
      )}

      {/* Calendário do mês — o que a arena tem, não só o que o aluno marcou.
          Tocar num dia abre o que há nele, com o caminho para entrar. */}
      <Reveal step={4} as="section">
        <SectionHeader title="Calendário da arena" />
        {monthEvents.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nada marcado neste mês"
            description="Quando a academia abrir turmas, torneios ou day use, eles aparecem aqui."
          />
        ) : (
          <ArenaCalendar
            todayISO={today}
            initialMonth={currentMonth}
            initialEvents={monthEvents}
          />
        )}
      </Reveal>
    </div>
  )
}
