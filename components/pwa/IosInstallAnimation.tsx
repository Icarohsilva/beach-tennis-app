'use client'
// components/pwa/IosInstallAnimation.tsx
// Passo a passo animado de "Adicionar à Tela de Início" no iPhone — o iOS não
// expõe nenhuma API de instalação, então o passo a passo é a única via.
// Sem biblioteca de animação: as cenas são estado do React com transições CSS.
// Usado em três lugares sem alteração: o sheet de instalação, a página
// /instalar e a captura de frames do GIF (via a prop `scene`).
import { useEffect, useState } from 'react'
import { Share, ChevronLeft, ChevronRight, BookOpen, Copy, Star, SquarePlus } from 'lucide-react'

export const SCENE_LEGENDAS = [
  'Toque no botão Compartilhar, na barra de baixo',
  'O menu vai subir na tela',
  'Role a lista até achar a opção',
  'Toque em "Adicionar à Tela de Início"',
  'Confirme em "Adicionar", lá em cima',
  'Pronto! O ArenaHub está na sua tela 🎉',
] as const

export const SCENE_COUNT = SCENE_LEGENDAS.length
export const SCENE_MS = 2200

// Passos em texto, para quem não quer esperar o loop, para prefers-reduced-motion
// e para leitores de tela.
export const PASSOS_TEXTO = [
  'Abra o ArenaHub no Safari (não funciona pelo Instagram nem pelo Chrome).',
  'Toque no botão Compartilhar — o quadradinho com a seta pra cima, na barra de baixo.',
  'Role o menu e toque em "Adicionar à Tela de Início".',
  'Toque em "Adicionar" no canto superior direito. O ícone aparece na sua tela.',
] as const

function Dedo({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`absolute h-9 w-9 rounded-full border-2 border-white/70 bg-white/25 shadow-lg transition-all duration-500 ${className}`}
    />
  )
}

export function IosInstallAnimation({ scene: forcada }: { scene?: number }) {
  const [auto, setAuto] = useState(0)
  const estatica = typeof forcada === 'number'
  const scene = estatica ? Math.min(Math.max(forcada, 0), SCENE_COUNT - 1) : auto

  useEffect(() => {
    if (estatica) return
    // Quem pediu menos movimento fica na cena 1 e lê os passos em texto.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setAuto((s) => (s + 1) % SCENE_COUNT), SCENE_MS)
    return () => clearInterval(id)
  }, [estatica])

  const sheetAberto = scene >= 1 && scene <= 4
  const listaRolada = scene >= 2
  const confirmando = scene === 4
  const instalado = scene === 5

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Moldura do iPhone. data-install-stage é o alvo do script de captura. */}
      <div
        data-install-stage
        className="relative h-[400px] w-[200px] shrink-0 overflow-hidden rounded-[30px] border-4 border-slate-700 bg-slate-950 shadow-2xl"
      >
        {/* Notch */}
        <div className="absolute left-1/2 top-0 z-30 h-4 w-20 -translate-x-1/2 rounded-b-xl bg-slate-700" />

        {/* --- Tela de início (cena final) --- */}
        <div
          className={`absolute inset-0 z-20 bg-gradient-to-b from-sky-900 to-slate-900 p-3 pt-8 transition-opacity duration-500 ${
            instalado ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl bg-white/10" />
            ))}
            <div
              className={`flex aspect-square items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-[9px] font-bold text-white ring-2 ring-white/70 ${
                instalado ? 'animate-bounce' : ''
              }`}
            >
              AH
            </div>
          </div>
          <p className="mt-2 text-center text-[8px] text-white/70">ArenaHub</p>
        </div>

        {/* --- Safari --- */}
        <div className="absolute inset-0 z-10 flex flex-col bg-slate-900 pt-6">
          <div className="mx-3 rounded-md bg-slate-800 px-2 py-1 text-center text-[8px] text-slate-400">
            arenahub.website
          </div>
          <div className="flex-1 space-y-2 p-3">
            <div className="rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 p-2">
              <div className="h-1.5 w-12 rounded bg-white/70" />
              <div className="mt-1 h-1 w-16 rounded bg-white/40" />
            </div>
            <div className="h-10 rounded-lg bg-slate-800" />
            <div className="h-10 rounded-lg bg-slate-800" />
          </div>
          {/* Barra inferior do Safari */}
          <div className="relative flex items-center justify-around border-t border-slate-800 px-3 py-2 text-slate-500">
            <ChevronLeft size={14} />
            <ChevronRight size={14} />
            <span
              className={`relative rounded p-1 transition-all ${
                scene === 0 ? 'bg-brand-500/30 text-brand-300 ring-2 ring-brand-400' : ''
              }`}
            >
              <Share size={14} />
              {scene === 0 && (
                <span className="absolute -inset-1 animate-ping rounded-full border-2 border-brand-400" />
              )}
            </span>
            <BookOpen size={14} />
            <span className="h-3 w-3 rounded-sm border border-current" />
          </div>
        </div>

        {/* --- Folha de compartilhamento --- */}
        <div
          className={`absolute inset-x-0 bottom-0 z-20 rounded-t-2xl bg-slate-800 p-3 shadow-2xl transition-transform duration-500 ${
            sheetAberto ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="mx-auto mb-2 h-1 w-8 rounded-full bg-slate-600" />
          <div className="mb-2 flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-gradient-to-br from-brand-500 to-brand-700" />
            <div>
              <p className="text-[8px] font-semibold text-white">ArenaHub</p>
              <p className="text-[7px] text-slate-400">arenahub.website</p>
            </div>
          </div>
          {/* A lista "rola": um translate negativo revela a opção que interessa. */}
          <div className="h-[104px] overflow-hidden">
            <div
              className={`space-y-1 transition-transform duration-500 ${
                listaRolada ? '-translate-y-[52px]' : 'translate-y-0'
              }`}
            >
              <Linha icone={<Copy size={11} />} texto="Copiar" />
              <Linha icone={<BookOpen size={11} />} texto="Adicionar à Lista de Leitura" />
              <Linha icone={<Star size={11} />} texto="Adicionar aos Favoritos" />
              <Linha
                icone={<SquarePlus size={11} />}
                texto="Adicionar à Tela de Início"
                destaque={scene >= 3}
              />
              <Linha icone={<Share size={11} />} texto="Marcação" />
            </div>
          </div>
        </div>

        {/* --- Confirmação "Adicionar" --- */}
        <div
          className={`absolute inset-0 z-[25] flex flex-col bg-slate-900 pt-6 transition-opacity duration-300 ${
            confirmando ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <span className="text-[8px] text-slate-400">Cancelar</span>
            <span className="text-[8px] font-semibold text-white">Tela de Início</span>
            <span className="rounded bg-brand-500/30 px-1.5 py-0.5 text-[8px] font-bold text-brand-200 ring-2 ring-brand-400">
              Adicionar
            </span>
          </div>
          <div className="flex items-center gap-2 p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-[8px] font-bold text-white">
              AH
            </div>
            <span className="text-[9px] text-white">ArenaHub</span>
          </div>
        </div>

        {/* --- Dedo --- */}
        {scene === 0 && <Dedo className="bottom-2 left-[86px] z-30" />}
        {scene === 3 && <Dedo className="bottom-[46px] left-[30px] z-30" />}
        {scene === 4 && <Dedo className="right-2 top-6 z-30" />}
      </div>

      <p className="min-h-[32px] max-w-[240px] text-center text-xs text-slate-300">
        <span className="font-bold text-brand-400">{Math.min(scene + 1, SCENE_COUNT)}.</span>{' '}
        {SCENE_LEGENDAS[scene]}
      </p>
    </div>
  )
}

function Linha({
  icone,
  texto,
  destaque,
}: {
  icone: React.ReactNode
  texto: string
  destaque?: boolean
}) {
  return (
    <div
      className={`flex h-12 items-center justify-between rounded-lg px-2 text-[8px] transition-all ${
        destaque
          ? 'bg-brand-500/20 text-white ring-2 ring-brand-400'
          : 'bg-slate-700/50 text-slate-300'
      }`}
    >
      <span>{texto}</span>
      <span className="text-slate-400">{icone}</span>
    </div>
  )
}
