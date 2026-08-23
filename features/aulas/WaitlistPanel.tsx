// features/aulas/WaitlistPanel.tsx
// Fila de espera de uma sessão, na tela da chamada. Só leitura, mais o convite
// por WhatsApp: quem entra e sai da fila é o aluno, e abrindo vaga o primeiro da
// fila é promovido automaticamente.
//
// O convite por WhatsApp continua aqui de propósito, mesmo com a promoção
// automática: serve para quem foi barrado (dívida, cota) ou está fora do corte
// de 1h, casos em que a automação não coloca ninguém.
import { Badge } from '@/components/ui/Badge'
import type { WaitlistRow } from './waitlistQueries'
import { buildWaitlistInviteMessage, buildWaitlistInviteUrl } from '@/lib/aulas/waitlistInvite'

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function WaitlistPanel({
  entries,
  orgName,
  className,
  sessionDate,
  startTime,
}: {
  entries: WaitlistRow[]
  orgName: string
  className: string
  sessionDate: string
  startTime: string
}) {
  if (entries.length === 0) return null

  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-semibold text-white">Lista de espera</h2>
        <Badge variant="default">{entries.length}</Badge>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Em ordem de chegada. Quando abre vaga, o 1º da fila entra na aula
        automaticamente e é avisado — o 2º vira 1º e também recebe aviso.
        Faltando menos de 1h para a aula, a entrada não é automática: use o
        WhatsApp para chamar alguém direto.
      </p>

      <ul className="divide-y divide-surface-border">
        {entries.map((e) => {
          const waUrl = buildWaitlistInviteUrl(
            e.phone,
            buildWaitlistInviteMessage({
              studentName: e.fullName,
              orgName,
              className,
              sessionDate,
              startTime,
            }),
          )

          return (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-bold text-slate-300">
                  {e.position}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white">{e.fullName}</span>
                  <span className="block text-[11px] text-slate-500">
                    Entrou {timeOnly(e.joinedAt)}
                    {e.firstNotifiedAt ? ` · avisado que é o 1º ${timeOnly(e.firstNotifiedAt)}` : ''}
                  </span>
                </span>
              </span>

              {waUrl ? (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg border border-green-600/50 bg-green-600/10 px-2.5 py-1.5 text-xs font-semibold text-green-400 transition-colors hover:bg-green-600/20"
                >
                  Chamar no WhatsApp
                </a>
              ) : (
                <span className="shrink-0 text-[11px] text-slate-500">Sem WhatsApp</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
