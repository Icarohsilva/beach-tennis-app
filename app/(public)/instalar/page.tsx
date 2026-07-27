// app/(public)/instalar/page.tsx
// Página pública com o passo a passo de instalação. Serve para dois usos: link
// compartilhável nos grupos das academias e fonte dos frames do GIF (?cena=N
// congela a animação num quadro específico).
import type { Metadata } from 'next'
import { IosInstallAnimation, PASSOS_TEXTO } from '@/components/pwa/IosInstallAnimation'
import { Logo } from '@/components/ui/Logo'

export const metadata: Metadata = {
  title: 'Como instalar o ArenaHub no seu celular',
  description:
    'Passo a passo para colocar o ArenaHub na tela de início do seu iPhone ou Android.',
}

export default function InstalarPage({
  searchParams,
}: {
  searchParams: { cena?: string }
}) {
  const cenaCrua = Number(searchParams.cena)
  const cena = Number.isInteger(cenaCrua) ? cenaCrua : undefined

  return (
    <main className="min-h-screen bg-surface px-4 py-8 text-white">
      <div className="mx-auto flex max-w-md flex-col items-center">
        <Logo variant="icon" size="sm" />
        <h1 className="mt-4 text-center text-xl font-bold">
          Bota o ArenaHub na sua tela de início 🏐
        </h1>
        <p className="mb-6 mt-2 text-center text-sm text-slate-400">
          Leva 10 segundos e suas aulas ficam a um toque.
        </p>

        <section className="w-full rounded-2xl border border-surface-border bg-surface-card p-5">
          <h2 className="mb-4 text-center text-sm font-semibold text-brand-400">
            No iPhone (Safari)
          </h2>
          <IosInstallAnimation scene={cena} />
          <ol className="mt-5 space-y-3 text-sm text-slate-400">
            {PASSOS_TEXTO.map((passo, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-bold text-brand-400">{i + 1}.</span>
                <span>{passo}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-4 w-full rounded-2xl border border-surface-border bg-surface-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-brand-400">No Android (Chrome)</h2>
          <p className="text-sm text-slate-400">
            Mais fácil ainda: abra o ArenaHub e toque em{' '}
            <strong className="text-slate-200">Instalar</strong> quando o aviso aparecer. Se ele
            não aparecer, toque nos três pontinhos no canto do Chrome e escolha{' '}
            <strong className="text-slate-200">
              &ldquo;Instalar aplicativo&rdquo;
            </strong>{' '}
            ou <strong className="text-slate-200">&ldquo;Adicionar à tela inicial&rdquo;</strong>.
          </p>
        </section>

        <section className="mt-4 w-full rounded-2xl border border-surface-border bg-surface-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-brand-400">
            E as notificações?
          </h2>
          <p className="text-sm text-slate-400">
            Depois de instalar, abra o app pela tela de início e toque em{' '}
            <strong className="text-slate-200">Ativar</strong> no aviso que aparece no topo. É por
            ali que chegam aula cancelada, vaga liberada na fila e lembrete de treino.
          </p>
        </section>
      </div>
    </main>
  )
}
