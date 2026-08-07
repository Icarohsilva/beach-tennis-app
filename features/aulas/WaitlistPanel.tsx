// features/aulas/WaitlistPanel.tsx
// Fila de espera de uma sessão, na tela da chamada. Só leitura: quem entra e
// sai da fila é o aluno, e a oferta de vaga é automática quando alguém cancela.
import { Badge } from '@/components/ui/Badge'
import type { WaitlistRow } from './waitlistQueries'

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function WaitlistPanel({ entries }: { entries: WaitlistRow[] }) {
  if (entries.length === 0) return null

  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-semibold text-white">Lista de espera</h2>
        <Badge variant="default">{entries.length}</Badge>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Em ordem de chegada. Quando alguém cancela, todos aqui são avisados na
        hora e a vaga fica com quem entrar primeiro.
      </p>

      <ul className="divide-y divide-surface-border">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-bold text-slate-300">
                {e.position}
              </span>
              <span className="truncate text-sm text-white">{e.fullName}</span>
            </span>
            <span className="shrink-0 text-xs text-slate-500">
              Entrou {timeOnly(e.joinedAt)}
              {e.notifiedAt ? ` · avisado ${timeOnly(e.notifiedAt)}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
