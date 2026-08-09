// features/liga/RulesCard.tsx
import { BookOpen, ChevronDown } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { DIVISION_LABEL } from '@/lib/liga/labels'
import type { LigaSettings } from './settings'

interface Props {
  settings: LigaSettings
}

interface Regra {
  label: string
  pontos: number
  detalhe?: string
}

/**
 * As regras do ranking, montadas a partir da configuração REAL da academia.
 *
 * Fonte com peso zero não aparece: a academia desligou, e listar uma regra que não
 * vale ponto seria o app mentindo para o aluno. É por isso que este bloco não é um
 * texto fixo — o texto fixo envelheceria no primeiro ajuste de peso.
 *
 * Vem recolhido num <details> nativo: precisa estar no topo para ser encontrado, mas
 * aberto empurraria o ranking (que é o que o aluno vem ver) para baixo da dobra.
 */
export function RulesCard({ settings }: Props) {
  const w = settings.weights

  const comoPontuar: Regra[] = [
    { label: 'Presença em aula', pontos: w.attendance },
    {
      label: 'Sequência de semanas',
      pontos: w.streakWeek,
      detalhe: 'por semana seguida treinando; o bônus cresce até 4x e estabiliza',
    },
    { label: 'Confirmar presença pelo app', pontos: w.selfCheckin },
    {
      label: 'Cancelar a tempo',
      pontos: w.cancelInTime,
      detalhe: 'dentro da janela, para outro aluno pegar a vaga',
    },
    { label: 'Pegar vaga da fila de espera', pontos: w.waitlistAccept },
    { label: 'Agendar com 2 dias ou mais', pontos: w.earlyBooking },
    { label: 'Reservar day use', pontos: w.dayUse },
    {
      label: 'Completar o cadastro',
      pontos: w.profileComplete,
      detalhe: 'uma vez só: telefone e contato de emergência',
    },
    { label: 'Entrar num torneio', pontos: w.tournamentEntry },
    {
      label: 'Vencer um torneio',
      pontos: w.tournamentWin,
      detalhe: `2º lugar leva ${Math.round(w.tournamentWin * 0.6)} e 3º leva ${Math.round(w.tournamentWin * 0.3)}`,
    },
    {
      label: 'Receber um elogio',
      pontos: settings.kudosPointsReceived,
      detalhe: 'de um colega',
    },
    {
      label: 'Elogiar um colega',
      pontos: settings.kudosPointsGiven,
      detalhe:
        settings.kudosWeeklyCap > 0
          ? `só os ${settings.kudosWeeklyCap} primeiros da semana pontuam, e um por colega`
          : undefined,
    },
  ].filter((r) => r.pontos > 0)

  return (
    <Card className="p-0 overflow-hidden">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 p-4">
          <BookOpen className="h-4 w-4 shrink-0 text-brand-500" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">Como funciona a Liga</span>
            <span className="block text-xs text-slate-400">
              {comoPontuar.length > 0
                ? `${comoPontuar[0].label} vale ${comoPontuar[0].pontos} pontos. Toque para ver tudo.`
                : 'Toque para ver as regras.'}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
        </summary>

        <div className="space-y-4 border-t border-surface-border p-4">
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              Como ganhar pontos
            </p>
            <ul className="space-y-1.5">
              {comoPontuar.map((regra) => (
                <li key={regra.label} className="flex items-start gap-2 text-sm">
                  <span className="w-10 shrink-0 text-right font-bold tabular-nums text-brand-500">
                    +{regra.pontos}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-slate-200">{regra.label}</span>
                    {regra.detalhe && (
                      <span className="block text-[11px] text-slate-500">{regra.detalhe}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              Divisões e temporada
            </p>
            <ul className="space-y-1.5 text-sm text-slate-300">
              <li>
                Você disputa dentro da sua divisão, contra quem está no mesmo ritmo:{' '}
                {DIVISION_LABEL.bronze.replace('Divisão ', '')} →{' '}
                {DIVISION_LABEL.prata.replace('Divisão ', '')} →{' '}
                {DIVISION_LABEL.ouro.replace('Divisão ', '')} →{' '}
                {DIVISION_LABEL.diamante.replace('Divisão ', '')}.
              </li>
              {settings.promoteCount > 0 && (
                <li>
                  No fim da temporada, os{' '}
                  <span className="font-semibold text-emerald-400">
                    {settings.promoteCount} primeiros sobem
                  </span>{' '}
                  de divisão.
                </li>
              )}
              {settings.demoteCount > 0 && (
                <li>
                  Os <span className="font-semibold text-rose-400">{settings.demoteCount} últimos descem</span>{' '}
                  — menos quem já está no Bronze.
                </li>
              )}
              <li>
                A temporada é mensal e os pontos zeram no dia 1º. Sua sequência de semanas e suas
                medalhas <span className="font-medium text-white">não</span> zeram.
              </li>
              <li>
                Cada modalidade tem o próprio ranking: dá para ser Ouro numa e Bronze na outra.
              </li>
            </ul>
          </div>

          <p className="text-[11px] text-slate-500">
            Não quer aparecer no ranking? Em Perfil → Liga você pode se ocultar e continuar
            ganhando pontos.
          </p>
        </div>
      </details>
    </Card>
  )
}
