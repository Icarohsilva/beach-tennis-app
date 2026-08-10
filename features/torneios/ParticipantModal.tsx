'use client'
// features/torneios/ParticipantModal.tsx
// Ficha do inscrito sobre a página do torneio.
//
// Um contexto com UM modal na raiz, e não um modal por linha da tabela: num
// torneio de 32 nomes seriam 32 componentes montados esperando um clique que
// vai acontecer no máximo uma vez.
//
// Os dados vêm no clique (getParticipantContact), nunca embutidos na página —
// senão o telefone de todos os inscritos viajaria no HTML.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { BarChart3, Flame, MessageCircle, ShieldAlert, X } from 'lucide-react'
import { PlayerAvatar } from './PlayerAvatar'
import { FormBadges } from './FormBadges'
import { getParticipantContact, type ParticipantContact } from './participantActions'

interface ParticipantContextValue {
  open: (playerId: string) => void
}

const Ctx = createContext<ParticipantContextValue | null>(null)

/** Abre a ficha de um inscrito. Fora do provider vira no-op silencioso. */
export function useParticipantModal(): ParticipantContextValue {
  return useContext(Ctx) ?? { open: () => {} }
}

export function ParticipantModalProvider({
  tournamentId,
  children,
}: {
  tournamentId: string
  children: React.ReactNode
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = useCallback((playerId: string) => setOpenId(playerId), [])

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {openId && (
        <ParticipantSheet
          tournamentId={tournamentId}
          playerId={openId}
          onClose={() => setOpenId(null)}
        />
      )}
    </Ctx.Provider>
  )
}

function ParticipantSheet({
  tournamentId,
  playerId,
  onClose,
}: {
  tournamentId: string
  playerId: string
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [data, setData] = useState<ParticipantContact | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setMounted(true), [])

  // Fecha no Esc e trava a rolagem do fundo. Em mobile o scroller costuma ser o
  // <html>, não o <body> — travar só um deixava a página rolar por trás.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const root = document.documentElement
    const prevRoot = root.style.overflow
    const prevBody = document.body.style.overflow
    root.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      root.style.overflow = prevRoot
      document.body.style.overflow = prevBody
    }
  }, [onClose])

  useEffect(() => {
    let active = true
    setData(null)
    setError(null)
    getParticipantContact(tournamentId, playerId).then((res) => {
      if (!active) return
      if (res.error) setError(res.error)
      else setData(res.data ?? null)
    })
    return () => {
      active = false
    }
  }, [tournamentId, playerId])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ficha do inscrito"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl border border-white/[0.08] bg-surface-card p-5 pb-safe shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Inscrito no torneio
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? (
          <p className="py-6 text-center text-sm text-red-400">{error}</p>
        ) : !data ? (
          <div className="py-8 text-center text-sm text-slate-400">Carregando…</div>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-3">
              <PlayerAvatar name={data.name} tone="brand" size="md" className="h-12 w-12 text-base" />
              <div className="min-w-0">
                <h2 className="truncate text-lg font-extrabold leading-tight text-white">
                  {data.name}
                </h2>
                {data.partnerName && (
                  <p className="truncate text-xs text-slate-400">Dupla com {data.partnerName}</p>
                )}
                {data.entryStatus === 'waitlist' && (
                  <p className="text-xs font-semibold text-amber-300">Na lista de espera</p>
                )}
              </div>
            </div>

            {/* Troféus primeiro: é o que dá peso ao nome antes do jogo. Só
                aparece para quem tem — zeros em fileira desanimam quem começou. */}
            {(data.career.titles > 0 || data.career.podiums > 0) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {data.career.titles > 0 && (
                  <Trophy medal="🥇" label={data.career.titles === 1 ? 'título' : 'títulos'} value={data.career.titles} />
                )}
                {data.career.podiums > data.career.titles && (
                  <Trophy medal="🏅" label={data.career.podiums === 1 ? 'pódio' : 'pódios'} value={data.career.podiums} />
                )}
                {data.career.tournaments > 0 && (
                  <Trophy medal="🎾" label={data.career.tournaments === 1 ? 'torneio' : 'torneios'} value={data.career.tournaments} />
                )}
              </div>
            )}

            <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Neste torneio
            </p>
            <dl className="mt-1.5 grid grid-cols-3 gap-2">
              <Stat label="Jogos" value={data.played} />
              <Stat label="Vitórias" value={data.wins} tone="emerald" />
              <Stat label="Derrotas" value={data.losses} />
            </dl>

            {/* Carreira na academia. Sem jogo nenhum a seção some em vez de
                mostrar uma fileira de zeros. */}
            {data.career.played > 0 && (
              <>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Na academia
                  </p>
                  {data.career.form.length > 0 && <FormBadges form={data.career.form} />}
                </div>
                <dl className="mt-1.5 grid grid-cols-3 gap-2">
                  <Stat label="Jogos" value={data.career.played} />
                  <Stat label="Vitórias" value={data.career.wins} tone="emerald" />
                  <Stat label="Aprov." value={data.career.winRate} suffix="%" />
                </dl>
                {data.career.streak.kind === 'win' && data.career.streak.count > 1 && (
                  <p className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-300">
                    <Flame className="h-3.5 w-3.5" aria-hidden />
                    {data.career.streak.count} vitórias seguidas
                  </p>
                )}
              </>
            )}

            <div className="mt-4 space-y-2">
              {data.whatsappUrl ? (
                <a
                  href={data.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-bold text-[#0b1a12] transition-opacity hover:opacity-90"
                >
                  <MessageCircle className="h-4 w-4" />
                  Falar no WhatsApp
                </a>
              ) : (
                <p className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-center text-xs text-slate-400">
                  <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
                  {data.contactBlocked === 'no_phone'
                    ? 'Esta pessoa não cadastrou telefone.'
                    : 'O contato fica visível para quem está no torneio.'}
                </p>
              )}

              <Link
                href={`/torneios/atleta/${data.playerId}`}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-brand-600/50"
              >
                <BarChart3 className="h-4 w-4" />
                Ver retrospecto completo
              </Link>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

function Trophy({ medal, label, value }: { medal: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-amber-200">
      <span aria-hidden>{medal}</span>
      <span className="tabular-nums">{value}</span>
      <span className="font-semibold text-amber-200/80">{label}</span>
    </span>
  )
}

function Stat({
  label,
  value,
  tone,
  suffix,
}: {
  label: string
  value: number
  tone?: 'emerald'
  suffix?: string
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5 text-center">
      <dd
        className={`text-xl font-extrabold leading-none tabular-nums ${
          tone === 'emerald' ? 'text-emerald-300' : 'text-white'
        }`}
      >
        {value}{suffix}
      </dd>
      <dt className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </dt>
    </div>
  )
}
