export const dynamic = 'force-dynamic'

// app/(super-admin)/super-admin/auditoria/page.tsx
// Trilha completa das ações do super-admin sobre as academias. Quem mexe no
// acesso ou na cobrança de um cliente fica registrado — e visível.
import Link from 'next/link'
import { listAuditLog, type PlatformAuditAction } from '@/features/super-admin/actions'

const AUDIT_LABEL: Record<PlatformAuditAction, string> = {
  suspend_org: 'Academia suspensa',
  reactivate_org: 'Academia reativada',
  extend_trial: 'Trial estendido',
  grant_comp: 'Cortesia concedida',
  revoke_comp: 'Cortesia revogada',
}

const AUDIT_STYLE: Record<PlatformAuditAction, string> = {
  suspend_org: 'bg-red-500/15 text-red-300',
  reactivate_org: 'bg-emerald-500/15 text-emerald-300',
  extend_trial: 'bg-sky-500/15 text-sky-300',
  grant_comp: 'bg-violet-500/15 text-violet-300',
  revoke_comp: 'bg-amber-500/15 text-amber-300',
}

// Resumo legível do payload — evita despejar JSON cru na tela.
function describe(action: PlatformAuditAction, details: Record<string, unknown>): string | null {
  if (action === 'extend_trial') {
    const days = details.days
    const to = typeof details.to === 'string' ? new Date(details.to).toLocaleDateString('pt-BR') : null
    if (typeof days === 'number' && to) return `+${days} dias — novo fim do trial em ${to}`
  }
  return null
}

export default async function AuditoriaPage() {
  const { entries, error } = await listAuditLog(undefined, 100)

  if (error) return <p className="text-sm text-red-400">{error}</p>

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold">Auditoria</h1>
        <p className="text-sm text-slate-400">
          Ações da plataforma sobre academias — suspensão, reativação, trial e cortesia.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surface-border px-4 py-12 text-center">
          <p className="text-sm font-semibold text-slate-300">Nenhuma ação registrada</p>
          <p className="mt-1 text-xs text-slate-500">
            A trilha começa a partir da primeira suspensão, extensão de trial ou cortesia.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border">
          {entries.map((e) => {
            const summary = describe(e.action, e.details)
            return (
              <li key={e.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${AUDIT_STYLE[e.action] ?? 'bg-slate-500/15 text-slate-300'}`}
                >
                  {AUDIT_LABEL[e.action] ?? e.action}
                </span>
                <div className="min-w-0 flex-1">
                  {e.organization_id ? (
                    <Link
                      href={`/super-admin/${e.organization_id}`}
                      className="text-sm font-semibold text-white hover:text-brand-400"
                    >
                      {e.organization_name ?? 'Academia removida'}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-slate-400">Academia removida</span>
                  )}
                  {summary && <p className="text-xs text-slate-400">{summary}</p>}
                  {e.note && <p className="text-xs italic text-slate-500">“{e.note}”</p>}
                </div>
                <span className="shrink-0 text-xs text-slate-500">
                  {new Date(e.created_at).toLocaleString('pt-BR')}
                  <span className="block text-right">{e.actor_name ?? 'plataforma'}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
