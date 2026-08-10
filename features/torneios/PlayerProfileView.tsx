// features/torneios/PlayerProfileView.tsx
// O retrospecto do atleta, já calculado.
//
// Separado da página de propósito: a página busca e calcula, este componente só
// desenha. Assim o layout pode ser conferido com dados de exemplo sem subir
// banco, que é como os defeitos visuais deste módulo apareceram.
import Link from 'next/link'
import { ArrowLeft, Handshake, Swords, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatDate } from '@/lib/utils/dateHelpers'
import { Card } from '@/components/ui/Card'
import { Reveal } from '@/components/ui/Reveal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PlayerAvatar } from './PlayerAvatar'
import { FormBadges } from './FormBadges'
import type {
  FormResult,
  HeadToHead,
  PartnerRecord,
  PlayerRecord,
  Streak,
  TrophyCount,
} from '@/lib/torneios/playerStats'

/** Uma linha de "últimos jogos", já resolvida em texto. */
export interface RecentMatchView {
  id: string
  tournamentId: string
  tournamentName: string
  date: string
  opponents: string
  score: string
  won: boolean | null
}

export interface PlayerProfileViewProps {
  name: string
  tournamentCount: number
  record: PlayerRecord
  trophies: TrophyCount
  streak: Streak
  form: FormResult[]
  rivals: HeadToHead[]
  partners: PartnerRecord[]
  recent: RecentMatchView[]
  nameById: Record<string, string>
  /** O perfil é do próprio usuário — esconde o bloco de confronto direto. */
  isMe: boolean
  /** Confronto de quem está olhando contra quem é olhado. */
  versusMe: HeadToHead | null
}

export function PlayerProfileView({
  name,
  tournamentCount,
  record,
  trophies,
  streak,
  form,
  rivals,
  partners,
  recent,
  nameById,
  isMe,
  versusMe,
}: PlayerProfileViewProps) {
  return (
    <div className="space-y-5 p-4 pb-24">
      <Reveal step={0}>
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900 p-5">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgb(255_255_255/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:26px_26px]"
          />
          <div className="relative">
            <Link
              href="/torneios"
              aria-label="Voltar para a Arena"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-sm transition-colors hover:bg-black/40"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>

            <div className="mt-4 flex items-center gap-3">
              <PlayerAvatar name={name} tone="gold" size="md" className="h-12 w-12 text-base" />
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-extrabold text-white">{name}</h1>
                <p className="text-sm font-medium text-white/85">
                  {tournamentCount === 0
                    ? 'Ainda sem torneios'
                    : `${tournamentCount} ${tournamentCount === 1 ? 'torneio' : 'torneios'} nesta academia`}
                </p>
              </div>
            </div>

            {form.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-white/70">
                  Forma
                </span>
                <FormBadges form={form} />
                {streak.count > 1 && (
                  <span className="rounded-full border border-white/25 bg-white/15 px-2 py-0.5 text-[11px] font-bold text-white">
                    {streak.count} {streak.kind === 'win' ? 'vitórias seguidas' : 'derrotas seguidas'}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </Reveal>

      {record.played === 0 ? (
        <EmptyState
          icon={Swords}
          title={isMe ? 'Você ainda não jogou torneio' : 'Este atleta ainda não jogou'}
          description="O retrospecto aparece assim que o primeiro placar for confirmado."
          ctaHref="/torneios"
          ctaLabel="Ver torneios abertos"
        />
      ) : (
        <>
          {versusMe && versusMe.played > 0 && (
            <Reveal step={1}>
              <Card accent>
                <p className="text-[11px] font-bold uppercase tracking-wide text-brand-400">
                  Você contra {name.split(' ')[0]}
                </p>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold tabular-nums text-white">
                    {versusMe.wins} × {versusMe.losses}
                  </span>
                  <span className="text-sm text-slate-400">
                    em {versusMe.played} {versusMe.played === 1 ? 'jogo' : 'jogos'}
                  </span>
                </div>
              </Card>
            </Reveal>
          )}

          <Reveal step={2} as="section">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Jogos" value={record.played} />
              <Stat label="Vitórias" value={record.wins} tone="emerald" />
              <Stat label="Aproveitamento" value={`${record.winRate}%`} />
              <Stat
                label="Saldo de games"
                value={record.diff > 0 ? `+${record.diff}` : String(record.diff)}
                tone={record.diff > 0 ? 'emerald' : record.diff < 0 ? 'red' : undefined}
              />
            </div>
          </Reveal>

          {trophies.podiums > 0 && (
            <Reveal step={3} as="section">
              <SectionTitle icon={Trophy}>Troféus</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                <Trofeu medal="🥇" label="Títulos" value={trophies.titles} />
                <Trofeu medal="🥈" label="Vices" value={trophies.runnerUps} />
                <Trofeu medal="🥉" label="Terceiros" value={trophies.thirds} />
              </div>
            </Reveal>
          )}

          {partners.length > 0 && (
            <Reveal step={4} as="section">
              <SectionTitle icon={Handshake}>Melhores parcerias</SectionTitle>
              <div className="space-y-1.5">
                {partners.map((p) => (
                  <Linha
                    key={p.partnerId}
                    id={p.partnerId}
                    name={nameById[p.partnerId] ?? 'Jogador'}
                    detail={`${p.played} ${p.played === 1 ? 'jogo' : 'jogos'}`}
                    right={`${p.winRate}%`}
                    rightTone={p.winRate >= 50 ? 'emerald' : 'slate'}
                  />
                ))}
              </div>
            </Reveal>
          )}

          {rivals.length > 0 && (
            <Reveal step={5} as="section">
              <SectionTitle icon={Swords}>Confrontos diretos</SectionTitle>
              <div className="space-y-1.5">
                {rivals.map((r) => (
                  <Linha
                    key={r.opponentId}
                    id={r.opponentId}
                    name={nameById[r.opponentId] ?? 'Jogador'}
                    detail={`${r.played} ${r.played === 1 ? 'confronto' : 'confrontos'}`}
                    right={`${r.wins} × ${r.losses}`}
                    rightTone={r.wins > r.losses ? 'emerald' : r.wins < r.losses ? 'red' : 'slate'}
                  />
                ))}
              </div>
            </Reveal>
          )}

          <Reveal step={6} as="section">
            <SectionTitle icon={Swords}>Últimos jogos</SectionTitle>
            <div className="space-y-1.5">
              {recent.map((m) => (
                <Link key={m.id} href={`/torneios/${m.tournamentId}`} className="block">
                  <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-surface-card px-3 py-2.5 transition-colors hover:border-brand-600/50">
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold',
                        m.won === true
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : m.won === false
                            ? 'bg-red-500/15 text-red-300'
                            : 'bg-white/[0.06] text-slate-400',
                      )}
                    >
                      {m.won === true ? 'V' : m.won === false ? 'D' : 'E'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{m.opponents}</p>
                      <p className="truncate text-xs text-slate-400">
                        {m.tournamentName}
                        {m.date ? ` · ${formatDate(m.date, "dd 'de' MMM")}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-white">
                      {m.score}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </Reveal>
        </>
      )}
    </div>
  )
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Trophy; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-white">
      <Icon className="h-4 w-4 text-brand-500" aria-hidden />
      {children}
    </h2>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'emerald' | 'red'
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-surface-card p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-extrabold leading-none tabular-nums',
          tone === 'emerald' ? 'text-emerald-300' : tone === 'red' ? 'text-red-300' : 'text-white',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function Trofeu({ medal, label, value }: { medal: string; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-surface-card p-3 text-center">
      <span className="text-2xl" aria-hidden>{medal}</span>
      <p className="mt-0.5 text-xl font-extrabold leading-none tabular-nums text-white">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    </div>
  )
}

function Linha({
  id,
  name,
  detail,
  right,
  rightTone,
}: {
  id: string
  name: string
  detail: string
  right: string
  rightTone: 'emerald' | 'red' | 'slate'
}) {
  return (
    <Link href={`/torneios/atleta/${id}`} className="block">
      <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-surface-card px-3 py-2.5 transition-colors hover:border-brand-600/50">
        <PlayerAvatar name={name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{name}</p>
          <p className="text-xs text-slate-400">{detail}</p>
        </div>
        <span
          className={cn(
            'shrink-0 text-sm font-bold tabular-nums',
            rightTone === 'emerald'
              ? 'text-emerald-300'
              : rightTone === 'red'
                ? 'text-red-300'
                : 'text-slate-300',
          )}
        >
          {right}
        </span>
      </div>
    </Link>
  )
}
