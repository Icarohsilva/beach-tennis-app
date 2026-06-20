// app/(admin)/admin/assinatura/page.tsx
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { CheckCircle, Sparkles, ShieldCheck, Lock } from 'lucide-react'
import { getStaffContext } from '@/lib/supabase/server'
import { getPlatformAccess } from '@/lib/billing/access'
import { PLATFORM_PLAN } from '@/lib/billing/platformPlan'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { SubscribeButton } from './SubscribeButton'

// O que a academia leva ao assinar — comunica o valor do plano.
const FEATURES = [
  'Agenda de aulas, turmas e lista de espera',
  'Gestão de alunos, créditos e presença',
  'Financeiro: mensalidades e pagamentos',
  'Comunidade, torneios e notificações',
  'Vitrine pública para captar novos alunos',
]

function formatDateBR(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('pt-BR')
}

function dayLabel(n: number): string {
  return `${n} ${n === 1 ? 'dia' : 'dias'}`
}

export default async function AssinaturaPage({
  searchParams,
}: {
  searchParams: { retorno?: string; preapproval_id?: string }
}) {
  const ctx = await getStaffContext()
  if (!ctx) redirect('/login')

  const access = await getPlatformAccess(ctx.organizationId)
  const price = PLATFORM_PLAN.priceMonthly.toFixed(2).replace('.', ',')
  // O MercadoPago anexa ?preapproval_id=... ao voltar do checkout. Mantém o
  // ?retorno=1 como fallback para compatibilidade.
  const justReturned = !!searchParams?.preapproval_id || searchParams?.retorno === '1'

  const isTrialing = access.allowed && access.status === 'trialing'
  const isActive = access.allowed && access.status === 'active'
  const isBlocked = !access.allowed

  const renewDate = formatDateBR(access.currentPeriodEnd)
  // Esconde a data "vitalícia" (academia da casa tem current_period_end em 2099).
  const showRenewDate = isActive && access.daysLeft <= 366 && !!renewDate

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-bold text-white">Assinatura da plataforma</h1>
      <p className="mt-1 text-sm text-slate-400">
        Tudo que sua arena precisa para funcionar, em um só lugar.
      </p>

      {justReturned && (
        <div
          className="mt-4 flex items-start gap-2 rounded-lg border border-brand-600/40 bg-brand-600/10 px-4 py-3 text-sm text-brand-100"
          role="status"
        >
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
          <span>
            Recebemos seu retorno do Mercado Pago. A confirmação do pagamento pode levar
            alguns instantes — atualize a página em um minuto.
          </span>
        </div>
      )}

      <Card className="mt-4 overflow-hidden p-0">
        {/* Cabeçalho de marca com preço e estado atual */}
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-white/90">{PLATFORM_PLAN.reason}</span>
            {isTrialing && <Badge variant="warning">Período grátis</Badge>}
            {isActive && <Badge variant="success">Ativa</Badge>}
            {isBlocked && <Badge variant="danger">Pausada</Badge>}
          </div>
          <div className="mt-3 flex items-end gap-1">
            <span className="text-4xl font-extrabold text-white">R$ {price}</span>
            <span className="pb-1 text-sm font-medium text-white/70">/mês</span>
          </div>
          <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-white/80">
            <Sparkles className="h-3.5 w-3.5" /> Primeiro mês grátis
          </p>
        </div>

        <div className="space-y-5 p-6">
          <ul className="space-y-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-slate-200">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <div className="border-t border-surface-border pt-5">
            {isTrialing && (
              <>
                <p className="text-sm text-slate-300">
                  Você está no <strong className="text-white">mês grátis</strong>. Faltam{' '}
                  <strong className="text-brand-400">{dayLabel(access.daysLeft)}</strong> — assine
                  para manter o painel ativo quando o período terminar.
                </p>
                {ctx.isOwner ? (
                  <div className="mt-4">
                    <SubscribeButton />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">
                    Só o dono da academia pode assinar. Fale com ele para concluir.
                  </p>
                )}
              </>
            )}

            {isActive && (
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-emerald-400">
                    Assinatura ativa. Obrigado por usar a plataforma!
                  </p>
                  {showRenewDate && (
                    <p className="mt-1 text-sm text-slate-400">Próxima renovação em {renewDate}.</p>
                  )}
                </div>
              </div>
            )}

            {isBlocked && (
              <>
                <div className="flex items-start gap-2">
                  <Lock className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                  <div>
                    <p className="text-sm font-semibold text-red-400">
                      Seu acesso ao painel está pausado.
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      Assine para voltar a usar a plataforma.{' '}
                      <span className="text-slate-300">
                        Seus alunos continuam usando o app normalmente.
                      </span>
                    </p>
                  </div>
                </div>
                {ctx.isOwner ? (
                  <div className="mt-4">
                    <SubscribeButton label="Assinar e desbloquear" />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">
                    Só o dono da academia pode regularizar a assinatura. Fale com ele.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
