// features/home/HeroHeader.tsx
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { GreetingLine } from './GreetingLine'

interface HeroStat {
  label: string
  value: string | number
  /**
   * Fração 0..1 do progresso. Desenha a barrinha sob o número — é o que faz um
   * "3/6" virar informação em vez de dois algarismos.
   */
  progress?: number
  /** Linha curta de contexto ("Faltam 3 para a meta"). */
  hint?: string
}

/**
 * Cabeçalho da home do aluno: gradiente da academia, malha técnica por cima e
 * os números do aluno em pastilhas de vidro.
 */
export function HeroHeader({ name, stats }: { name: string; stats: HeroStat[] }) {
  return (
    <div className="sheen relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900 p-5 shadow-[0_24px_60px_-28px_rgb(var(--brand-600)/0.95)]">
      {/* Malha fina: dá textura de painel técnico ao gradiente. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgb(255_255_255/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:24px_24px]"
      />
      {/* Clarão diagonal no canto superior. */}
      <div
        aria-hidden
        className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/20 blur-3xl"
      />

      <div className="relative">
        <GreetingLine name={name} />

        {/* 2 colunas em celular, 3 só a partir de `sm` (640px). Em 3 colunas a
            pastilha tinha ~71px de caixa de texto num iPhone 11 e ~53px num SE — e o
            rótulo mais longo ("CHECK-INS DO MÊS · WELLHUB") sozinho pede bem mais que
            isso. Resultado: rótulo, número e dica se empilhavam colados, que é o
            "texto em cima do outro" relatado. Três KPIs lado a lado só fazem sentido
            em tela larga; até lá a terceira pastilha — a que carrega rótulo longo,
            barra e dica — ocupa a linha inteira. */}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={
                'min-w-0 rounded-2xl border border-white/15 bg-white/10 px-2.5 py-2.5 backdrop-blur-sm xs:px-3' +
                (i >= 2 ? ' col-span-2 sm:col-span-1' : '')
              }
            >
              {/* tracking contido + break-words: "Aulas/semana" é um token único (o
                  navegador não quebra em "/"), e com tracking-[0.12em] media 87px
                  numa caixa de 82px — transbordava a pastilha em 414px. */}
              <p className="break-words text-[9px] font-bold uppercase tracking-wide text-white/75 xs:tracking-[0.1em]">
                {stat.label}
              </p>
              <p className="mt-0.5 text-xl font-extrabold leading-none text-white">
                {typeof stat.value === 'number' ? (
                  <AnimatedNumber value={stat.value} />
                ) : (
                  <span className="break-words text-base">{stat.value}</span>
                )}
              </p>
              {stat.progress !== undefined && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/25">
                  <div
                    className="h-full rounded-full bg-white/90 transition-all duration-500"
                    // Clamp aqui, não em quem chama: meta batida com sobra
                    // (7 de 6) estouraria a barra para fora da pastilha.
                    style={{ width: `${Math.min(Math.max(stat.progress, 0), 1) * 100}%` }}
                  />
                </div>
              )}
              {stat.hint && (
                <p className="mt-1.5 text-[10px] font-semibold leading-tight text-white/75">
                  {stat.hint}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
