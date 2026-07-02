// app/(super-admin)/super-admin/[id]/page.tsx
import Link from 'next/link'
import { getOrganizationDetail } from '@/features/super-admin/actions'
import { Badge } from '@/components/ui/Badge'
import { SuspendToggle } from './SuspendToggle'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

export default async function OrgDetailPage({ params }: { params: { id: string } }) {
  const { detail, error } = await getOrganizationDetail(params.id)
  if (error || !detail) {
    return <p className="text-sm text-red-400">{error ?? 'Academia não encontrada.'}</p>
  }

  return (
    <div className="space-y-5">
      <Link href="/super-admin" className="text-sm text-brand-400 hover:text-brand-300">
        ← Voltar
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{detail.name}</h1>
        <Badge variant={detail.status === 'suspended' ? 'danger' : 'success'}>
          {detail.status === 'suspended' ? 'Suspensa' : 'Ativa'}
        </Badge>
      </div>

      {/* Dados da academia */}
      <div className="space-y-1.5 rounded-xl border border-surface-border bg-surface-card p-4 text-sm">
        <p><span className="text-slate-500">Slug:</span> {detail.slug}</p>
        <p>
          <span className="text-slate-500">Local:</span>{' '}
          {[detail.city, detail.state].filter(Boolean).join('/') || '—'}
        </p>
        <p><span className="text-slate-500">Dono:</span> {detail.owner_name ?? '—'}</p>
        <p><span className="text-slate-500">E-mail:</span> {detail.owner_email ?? '—'}</p>
        <p><span className="text-slate-500">Descrição:</span> {detail.description ?? '—'}</p>
        <p><span className="text-slate-500">Criada em:</span> {fmtDate(detail.created_at)}</p>
      </div>

      {/* Assinatura SaaS */}
      <div className="space-y-1.5 rounded-xl border border-surface-border bg-surface-card p-4 text-sm">
        <h2 className="mb-1 font-bold">Assinatura</h2>
        <p><span className="text-slate-500">Status:</span> {detail.sub_status}</p>
        <p><span className="text-slate-500">Fim do trial:</span> {fmtDate(detail.trial_ends_at)}</p>
        <p>
          <span className="text-slate-500">Fim do período atual:</span>{' '}
          {fmtDate(detail.current_period_end)}
        </p>
      </div>

      {/* Contadores */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-surface-border bg-surface-card p-4 text-center">
          <p className="text-2xl font-bold">{detail.students}</p>
          <p className="text-xs text-slate-500">Alunos</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-surface-card p-4 text-center">
          <p className="text-2xl font-bold">{detail.admins}</p>
          <p className="text-xs text-slate-500">Professores/Admins</p>
        </div>
        <div className="rounded-xl border border-surface-border bg-surface-card p-4 text-center">
          <p className="text-2xl font-bold">{detail.tournaments}</p>
          <p className="text-xs text-slate-500">Torneios</p>
        </div>
      </div>

      {/* Ação */}
      <div className="rounded-xl border border-surface-border bg-surface-card p-4">
        <SuspendToggle orgId={detail.id} status={detail.status} />
      </div>
    </div>
  )
}
